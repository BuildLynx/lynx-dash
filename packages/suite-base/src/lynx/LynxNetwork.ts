// SPDX-License-Identifier: MPL-2.0

import {
  channelTopicsFrom,
  effectiveMeta,
  rerootAbout,
  type ChannelCommand,
  type ComponentMeta,
  type DeploymentMeta,
  type EffectiveMeta,
  type Observer,
  type ObserverEvent,
} from "lynx-sdk-typescript";

import { LYNX_DASH_COMPONENT_NAME } from "@lichtblick/suite-base/lynx/lynxIdentity";
import {
  EMPTY_NETWORK_SNAPSHOT,
  channelBaseOfDataTopic,
  type JsonSchema,
  type LynxChannelView,
  type LynxComponentView,
  type LynxEndpointAbout,
  type LynxNetworkSnapshot,
  type LynxNoticeEntry,
  type LynxUnsupportedView,
} from "@lichtblick/suite-base/lynx/types";

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value != undefined && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** How long a burst of changes is allowed to accumulate before subscribers are told. */
const NOTIFY_DELAY_MS = 50;
const MAX_NOTICES_PER_COMPONENT = 100;

export type LynxNetworkListener = (snapshot: LynxNetworkSnapshot) => void;
export type LynxNoticeListener = (entry: LynxNoticeEntry) => void;
export type LynxProblemListener = (path: string, message: string) => void;

/** Title and description of a component, resolved as the spec says (A3.0 section 4.4). */
function metaOf(fallbackName: string, component: Rec, deployedName: string, deployment: Rec): EffectiveMeta {
  const componentMeta: ComponentMeta = {
    name: str(component.name, fallbackName),
    title: str(component.title),
    description: str(component.description),
    lynx_version: str(component.lynx_version),
  };
  const deploymentMeta: DeploymentMeta = { name: deployedName };
  if (typeof deployment.title === "string") {
    deploymentMeta.title = deployment.title;
  }
  if (typeof deployment.description === "string") {
    deploymentMeta.description = deployment.description;
  }
  return effectiveMeta(componentMeta, deploymentMeta);
}

function channelView(servicePath: string, key: string, raw: unknown): LynxChannelView | undefined {
  if (!isRec(raw)) {
    return undefined;
  }
  const component = isRec(raw.component) ? raw.component : {};
  const config = isRec(raw.config) ? raw.config : {};
  const deploymentRaw = isRec(config.deployment) ? config.deployment : {};
  const deployedName = str(deploymentRaw.name, str(component.name, key));
  const meta = metaOf(key, component, deployedName, deploymentRaw);

  const endpoints = (isRec(raw.endpoints) ? raw.endpoints : {}) as Record<string, LynxEndpointAbout>;
  const topics = channelTopicsFrom(endpoints) ?? undefined;
  const dataTopic = topics?.data;
  const base = dataTopic != undefined ? channelBaseOfDataTopic(dataTopic) : `${servicePath}/${deployedName}`;

  const payloadSchema = dataTopic != undefined ? endpoints[dataTopic]?.payload_schema : undefined;
  const streamTopic = topics?.stream;
  const streamRequestSchema = streamTopic != undefined ? endpoints[streamTopic]?.payload_schema : undefined;

  const status = isRec(raw.status) ? raw.status : {};
  const command = isRec(status.command) && typeof status.command.command === "string" ? (status.command as unknown as ChannelCommand) : undefined;

  return {
    kind: "channel",
    servicePath,
    key,
    name: meta.name,
    title: meta.title !== "" ? meta.title : meta.name,
    description: meta.description,
    topics,
    dataTopic,
    base,
    endpoints,
    payloadSchema: payloadSchema ?? undefined,
    streamRequestSchema: streamRequestSchema ?? undefined,
    command: command ?? null,
    config,
  };
}

/**
 * The dash's view of the network: a snapshot derived from an SDK {@link Observer}.
 *
 * The Observer owns protocol truth (roster from retained Status, About cache, freshness,
 * Sync, Notices). This class turns it into what the UI needs and tells subscribers, at most
 * once per {@link NOTIFY_DELAY_MS}, when it changed.
 */
export class LynxNetwork {
  readonly #observer: Observer;
  readonly #listeners = new Set<LynxNetworkListener>();
  readonly #noticeListeners = new Set<LynxNoticeListener>();
  readonly #problemListeners = new Set<LynxProblemListener>();
  readonly #notices = new Map<string, LynxNoticeEntry[]>();
  readonly #unsupported = new Map<string, string>();
  readonly #unsubscribeObserver: () => void;
  #snapshot: LynxNetworkSnapshot = EMPTY_NETWORK_SNAPSHOT;
  #version = 0;
  #dirty = true;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

  public constructor(observer: Observer) {
    this.#observer = observer;
    this.#unsubscribeObserver = observer.addListener((event) => {
      this.#handleEvent(event);
    });
  }

  public dispose(): void {
    this.#disposed = true;
    this.#unsubscribeObserver();
    if (this.#timer != undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#listeners.clear();
    this.#noticeListeners.clear();
    this.#problemListeners.clear();
  }

  public subscribe(listener: LynxNetworkListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public onNotice(listener: LynxNoticeListener): () => void {
    this.#noticeListeners.add(listener);
    return () => {
      this.#noticeListeners.delete(listener);
    };
  }

  /** Problems that are not Notices: malformed messages from a component, and the like. */
  public onProblem(listener: LynxProblemListener): () => void {
    this.#problemListeners.add(listener);
    return () => {
      this.#problemListeners.delete(listener);
    };
  }

  /** The current snapshot, rebuilt first if anything changed since the last call. */
  public snapshot(): LynxNetworkSnapshot {
    if (this.#dirty) {
      this.#snapshot = this.#build();
      this.#dirty = false;
    }
    return this.#snapshot;
  }

  public component(path: string): LynxComponentView | undefined {
    return this.snapshot().components[path];
  }

  public channel(servicePath: string, key: string): LynxChannelView | undefined {
    return this.component(servicePath)?.channels[key];
  }

  public channelByDataTopic(dataTopic: string): LynxChannelView | undefined {
    for (const component of Object.values(this.snapshot().components)) {
      for (const channel of Object.values(component.channels)) {
        if (channel.dataTopic === dataTopic) {
          return channel;
        }
      }
    }
    return undefined;
  }

  public allChannels(): LynxChannelView[] {
    const out: LynxChannelView[] = [];
    for (const component of Object.values(this.snapshot().components)) {
      out.push(...Object.values(component.channels));
    }
    return out;
  }

  public recentNotices(path: string): readonly LynxNoticeEntry[] {
    return this.#notices.get(path) ?? [];
  }

  /** Catch up one component with Sync (or a full About when it has none). */
  public reconcile(path: string): boolean {
    return this.#observer.reconcile(path);
  }

  /** Reconcile every observed component. */
  public reconcileAll(): void {
    for (const path of this.#observer.paths()) {
      this.#observer.reconcile(path);
    }
  }

  #handleEvent(event: ObserverEvent): void {
    if (this.#disposed) {
      return;
    }
    switch (event.kind) {
      case "notice":
        this.#recordNotice(event);
        return;
      case "error":
        if (event.detail.legacy === true) {
          this.#unsupported.set(event.path, typeof event.detail.message === "string" ? event.detail.message : "Speaks an older protocol");
          this.#markDirty();
        } else {
          const message = typeof event.detail.message === "string" ? event.detail.message : "Unknown error";
          for (const listener of [...this.#problemListeners]) {
            listener(event.path, message);
          }
        }
        return;
      case "joined":
      case "about":
        this.#unsupported.delete(event.path);
        break;
      case "left":
        this.#notices.delete(event.path);
        break;
      case "synced":
        break;
      default:
        break;
    }
    this.#markDirty();
  }

  #recordNotice(event: ObserverEvent): void {
    const raw = event.detail.notice;
    if (!isRec(raw)) {
      return;
    }
    const entry: LynxNoticeEntry = {
      path: event.path,
      receivedAt: Date.now(),
      severity: typeof raw.severity === "number" ? raw.severity : 2,
      action: str(raw.action),
      message: str(raw.message),
      data: isRec(raw.data) ? raw.data : {},
    };
    const list = this.#notices.get(event.path) ?? [];
    list.push(entry);
    if (list.length > MAX_NOTICES_PER_COMPONENT) {
      list.splice(0, list.length - MAX_NOTICES_PER_COMPONENT);
    }
    this.#notices.set(event.path, list);
    for (const listener of [...this.#noticeListeners]) {
      listener(entry);
    }
  }

  #markDirty(): void {
    this.#dirty = true;
    if (this.#timer != undefined || this.#disposed) {
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#disposed) {
        return;
      }
      const snapshot = this.snapshot();
      for (const listener of [...this.#listeners]) {
        listener(snapshot);
      }
    }, NOTIFY_DELAY_MS);
  }

  #build(): LynxNetworkSnapshot {
    const components: Record<string, LynxComponentView> = {};

    for (const path of this.#observer.paths()) {
      const record = this.#observer.get(path);
      if (record == undefined) {
        continue;
      }
      const rooted = record.about != undefined ? rerootAbout(record.about, record.prefix) : undefined;
      const view = this.#componentView(path, record, rooted);
      // Every browser tab is its own dash, and a closed tab leaves a retained "down" record
      // behind. Other dashes are only worth listing while they are up.
      if (view.componentName === LYNX_DASH_COMPONENT_NAME && view.connected === false) {
        continue;
      }
      components[path] = view;
    }

    const childrenOf: Record<string, string[]> = {};
    const roots: string[] = [];
    for (const path of Object.keys(components).sort()) {
      const parent = components[path]!.parentPath;
      if (parent == undefined) {
        roots.push(path);
      } else {
        (childrenOf[parent] ??= []).push(path);
      }
    }

    const unsupported: LynxUnsupportedView[] = [...this.#unsupported.entries()]
      .filter(([path]) => !(path in components))
      .map(([path, reason]) => ({ path, reason }))
      .sort((a, b) => a.path.localeCompare(b.path));

    this.#version += 1;
    return { version: this.#version, components, roots, childrenOf, unsupported };
  }

  #componentView(
    path: string,
    record: NonNullable<ReturnType<Observer["get"]>>,
    rooted: Rec | undefined,
  ): LynxComponentView {
    const name = record.name;
    const slash = path.lastIndexOf("/");
    const parentPath = slash > 0 ? path.slice(0, slash) : undefined;

    const component = rooted != undefined && isRec(rooted.component) ? rooted.component : {};
    const config = rooted != undefined && isRec(rooted.config) ? rooted.config : {};
    const deploymentRaw = isRec(config.deployment) ? config.deployment : {};
    const meta = metaOf(name, component, name, deploymentRaw);

    const endpoints = (rooted != undefined && isRec(rooted.endpoints) ? rooted.endpoints : {}) as Record<string, LynxEndpointAbout>;
    const timeSource = typeof component.time_source === "string" ? component.time_source : undefined;

    const channels: Record<string, LynxChannelView> = {};
    if (rooted != undefined && isRec(rooted.channels)) {
      for (const [key, raw] of Object.entries(rooted.channels)) {
        const view = channelView(path, key, raw);
        if (view != undefined) {
          channels[key] = view;
        }
      }
    }

    return {
      kind: record.lynxType === "Node" ? "node" : "service",
      path,
      name,
      parentPath,
      title: meta.title !== "" ? meta.title : name,
      description: meta.description,
      componentName: str(component.name, name),
      lynxVersion: str(component.lynx_version),
      timeSource,
      connected: record.connected,
      stale: this.#observer.isStale(path),
      loading: rooted == undefined,
      generation: record.generation,
      noticeLevel: typeof config.notice_level === "number" ? config.notice_level : undefined,
      supportsSync: `${path}/?/Sync` in endpoints,
      endpoints,
      channels,
      listedServices: rooted != undefined && isRec(rooted.services) ? Object.keys(rooted.services).sort() : [],
      listedNodes: rooted != undefined && isRec(rooted.childNodes) ? Object.keys(rooted.childNodes).sort() : [],
    };
  }
}

export type { JsonSchema };
