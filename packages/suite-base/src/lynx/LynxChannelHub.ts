// SPDX-License-Identifier: MPL-2.0

import {
  ChannelClient,
  buildStreamPayload,
  type ChannelBatch,
  type StreamRequestInput,
} from "lynx-sdk-typescript";

import type { LynxNetwork } from "@lichtblick/suite-base/lynx/LynxNetwork";
import {
  LynxStreamSettingsStore,
  buildRequest,
  dataFieldNames,
  deriveContents,
} from "@lichtblick/suite-base/lynx/LynxStreamSettings";
import type { LynxChannelView } from "@lichtblick/suite-base/lynx/types";

/** How the hub talks to the broker. Commands go at QoS 1. */
export interface LynxHubTransport {
  publish: (topic: string, payload: Record<string, unknown>) => void;
  subscribe: (topic: string) => void;
  unsubscribe: (topic: string) => void;
}

/** One entry per subscription to a Channel: the field names it needs, or undefined for whole messages. */
export type LynxWantedFields = ReadonlyArray<readonly string[] | undefined>;

export interface LynxChannelRuntime {
  /** A panel (or the user, by starting it) wants this Channel's data. */
  wanted: boolean;
  /** The user stopped it; it stays stopped until the panels let go of it or the user starts it again. */
  paused: boolean;
  /**
   * `idle`: nothing is streaming. `own`: the dash started the running Stream. `shared`: another
   * consumer did, and the dash is only listening.
   */
  ownership: "idle" | "own" | "shared";
  /** A request was sent and the Channel has not reported it running yet. */
  starting: boolean;
  /** The request of the running Stream, whoever started it. */
  running: Record<string, unknown> | undefined;
  /** What the dash would ask for now, from the user's settings and what the panels plot. */
  desired: StreamRequestInput | undefined;
  /** The component that owns the Channel is not connected. */
  componentDown: boolean;
}

export interface LynxHubProblem {
  severity: "warn" | "info";
  message: string;
  tip?: string;
}

export type LynxHubBatchListener = (channel: LynxChannelView, batch: ChannelBatch) => void;
export type LynxHubProblemListener = (key: string, problem: LynxHubProblem | undefined) => void;

export interface LynxChannelHubOptions {
  network: LynxNetwork;
  transport: LynxHubTransport;
  settings: LynxStreamSettingsStore;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** How long a Stream request may go unanswered before it is sent again. Default 3000. */
  pendingTimeoutMs?: number;
}

const IDLE_RUNTIME: LynxChannelRuntime = {
  wanted: false,
  paused: false,
  ownership: "idle",
  starting: false,
  running: undefined,
  desired: undefined,
  componentDown: false,
};

interface Entry {
  channel: LynxChannelView;
  client: ChannelClient;
  topicsKey: string;
  unsubscribeBatches: () => void;
  pendingSince: number | undefined;
  restarting: boolean;
  /** The desired request as of the last evaluation. */
  desired: StreamRequestInput | undefined;
}

/** JSON with sorted keys, so two requests with the same content compare equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (typeof value === "object" && value != undefined) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Streams for the Channels the dash wants data from.
 *
 * A Channel runs one command at a time, so its Stream may belong to someone else. The hub
 * shares such a Stream and never stops it; it stops only Streams it started. It starts a Stream
 * when a Channel is wanted and idle, restarts its own when the settings or the fields the panels
 * plot change, and takes over when a shared Stream ends while data is still wanted. Stopping a
 * Stream explicitly (`stop`) or replacing one (`restart`) is the user's choice and is never
 * done on their behalf.
 */
export class LynxChannelHub {
  readonly #network: LynxNetwork;
  readonly #transport: LynxHubTransport;
  readonly #settings: LynxStreamSettingsStore;
  readonly #now: () => number;
  readonly #pendingTimeoutMs: number;

  readonly #panelWanted = new Map<string, LynxWantedFields>();
  readonly #manual = new Set<string>();
  readonly #paused = new Set<string>();
  readonly #entries = new Map<string, Entry>();
  readonly #batchListeners = new Set<LynxHubBatchListener>();
  readonly #problemListeners = new Set<LynxHubProblemListener>();
  readonly #stateListeners = new Set<() => void>();
  readonly #problems = new Map<string, LynxHubProblem>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #unsubscribeNetwork: () => void;
  readonly #unsubscribeSettings: () => void;
  #signature = "";
  #version = 0;
  #disposed = false;

  public constructor(options: LynxChannelHubOptions) {
    this.#network = options.network;
    this.#transport = options.transport;
    this.#settings = options.settings;
    this.#now = options.now ?? Date.now;
    this.#pendingTimeoutMs = options.pendingTimeoutMs ?? 3000;
    this.#unsubscribeNetwork = this.#network.subscribe(() => {
      this.refresh();
    });
    this.#unsubscribeSettings = this.#settings.subscribe(() => {
      this.refresh();
    });
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#unsubscribeNetwork();
    this.#unsubscribeSettings();
    for (const timer of this.#timers) {
      clearTimeout(timer);
    }
    this.#timers.clear();
    for (const topic of [...this.#entries.keys()]) {
      this.#dropEntry(topic);
    }
    this.#batchListeners.clear();
    this.#problemListeners.clear();
    this.#stateListeners.clear();
  }

  // ---- what is wanted ---------------------------------------------------------

  /** Replace the set of Channels the panels want, with the fields each subscription needs. */
  public setWanted(wanted: ReadonlyMap<string, LynxWantedFields>): void {
    this.#panelWanted.clear();
    for (const [topic, fields] of wanted) {
      this.#panelWanted.set(topic, fields);
    }
    for (const topic of [...this.#paused]) {
      // A pause lasts only while the Channel is wanted.
      if (!this.#panelWanted.has(topic) && !this.#manual.has(topic)) {
        this.#paused.delete(topic);
      }
    }
    this.refresh();
  }

  // ---- explicit actions ---------------------------------------------------------

  /** Stream a Channel although no panel plots it. Shares a running Stream rather than replacing it. */
  public start(topic: string): void {
    this.#manual.add(topic);
    this.#paused.delete(topic);
    this.refresh();
  }

  /** Stop the Stream of a Channel, even one started by someone else, and keep it stopped. */
  public stop(topic: string): void {
    this.#manual.delete(topic);
    if (this.#panelWanted.has(topic)) {
      this.#paused.add(topic);
    }
    const entry = this.#entries.get(topic) ?? this.#temporaryEntry(topic);
    entry?.client.stop({ force: true });
    this.refresh();
  }

  /** Replace whatever is streaming with a Stream that has this dash's settings. */
  public async restart(topic: string): Promise<void> {
    if (!this.#panelWanted.has(topic)) {
      this.#manual.add(topic);
    }
    this.#paused.delete(topic);
    this.refresh();
    const entry = this.#entries.get(topic);
    if (entry == undefined) {
      return;
    }
    const desired = this.#desiredFor(entry.channel);
    entry.restarting = true;
    try {
      const outcome = await entry.client.restart(desired);
      if (outcome.started) {
        entry.pendingSince = this.#now();
      }
    } finally {
      entry.restarting = false;
      this.refresh();
    }
  }

  /** One sample, on demand, for a Channel that is wanted. Returns whether a Poll was sent. */
  public poll(topic: string): boolean {
    return this.#entries.get(topic)?.client.poll() ?? false;
  }

  // ---- state for the UI ------------------------------------------------------------

  public runtime(topic: string): LynxChannelRuntime {
    const entry = this.#entries.get(topic);
    const wanted = this.#isWanted(topic);
    if (entry == undefined) {
      return { ...IDLE_RUNTIME, wanted, paused: this.#paused.has(topic) };
    }
    const command = entry.client.currentCommand;
    const running = command?.command === "Stream" ? (command.payload ?? {}) : undefined;
    const component = this.#network.component(entry.channel.servicePath);
    return {
      wanted,
      paused: this.#paused.has(topic),
      ownership: entry.client.ownership,
      starting: entry.pendingSince != undefined && command == undefined,
      running,
      desired: entry.desired,
      componentDown: component?.connected !== true,
    };
  }

  /** Called whenever any Channel's runtime may have changed. */
  public subscribe(listener: () => void): () => void {
    this.#stateListeners.add(listener);
    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  /** Bumped whenever a runtime changed; for `useSyncExternalStore`. */
  public getVersion(): number {
    return this.#version;
  }

  public onBatch(listener: LynxHubBatchListener): () => void {
    this.#batchListeners.add(listener);
    return () => {
      this.#batchListeners.delete(listener);
    };
  }

  public onProblem(listener: LynxHubProblemListener): () => void {
    this.#problemListeners.add(listener);
    return () => {
      this.#problemListeners.delete(listener);
    };
  }

  // ---- traffic ---------------------------------------------------------------------

  /** Feed an inbound MQTT message; messages for other topics are ignored. */
  public handleMessage(topic: string, payload: unknown, time?: { sec?: number; nsec?: number }): void {
    this.#entries.get(topic)?.client.handleMessage(topic, payload, time);
  }

  /**
   * Bring every Channel up to date: after a network change, a settings change, or a change in
   * what is wanted. Cheap when nothing changed.
   */
  public refresh(): void {
    if (this.#disposed) {
      return;
    }
    const wantedTopics = new Set<string>([...this.#panelWanted.keys(), ...this.#manual]);

    for (const topic of [...this.#entries.keys()]) {
      if (!wantedTopics.has(topic)) {
        this.#dropEntry(topic);
      }
    }

    for (const topic of wantedTopics) {
      const channel = this.#network.channelByDataTopic(topic);
      const existing = this.#entries.get(topic);
      if (channel == undefined) {
        // Not (or no longer) on the network: it will be picked up when it appears.
        if (existing != undefined) {
          this.#dropEntry(topic);
        }
        continue;
      }
      const topicsKey = stableJson(channel.topics);
      let entry = existing;
      if (entry != undefined && entry.topicsKey !== topicsKey) {
        this.#dropEntry(topic);
        entry = undefined;
      }
      entry ??= this.#createEntry(topic, channel, topicsKey);
      entry.channel = channel;
      entry.client.updateCommand(channel.command);
      this.#ensure(topic, entry);
    }

    this.#publishState();
  }

  // ---- internals ---------------------------------------------------------------------

  #isWanted(topic: string): boolean {
    return this.#panelWanted.has(topic) || this.#manual.has(topic);
  }

  #createEntry(topic: string, channel: LynxChannelView, topicsKey: string): Entry {
    const component = this.#network.component(channel.servicePath);
    const client = new ChannelClient({
      topics: channel.topics!,
      send: (to, payload) => {
        this.#transport.publish(to, payload);
      },
      subscribe: (to) => {
        this.#transport.subscribe(to);
      },
      unsubscribe: (to) => {
        this.#transport.unsubscribe(to);
      },
      publisherTimeSource: component?.timeSource,
    });
    const entry: Entry = {
      channel,
      client,
      topicsKey,
      unsubscribeBatches: client.onBatch((batch) => {
        for (const listener of [...this.#batchListeners]) {
          listener(entry.channel, batch);
        }
      }),
      pendingSince: undefined,
      restarting: false,
      desired: undefined,
    };
    client.open();
    this.#entries.set(topic, entry);
    return entry;
  }

  /** A client for a Channel nobody wants, for one command. It is not kept. */
  #temporaryEntry(topic: string): Entry | undefined {
    const channel = this.#network.channelByDataTopic(topic);
    if (channel?.topics == undefined) {
      return undefined;
    }
    const client = new ChannelClient({
      topics: channel.topics,
      send: (to, payload) => {
        this.#transport.publish(to, payload);
      },
      subscribe: () => {},
      unsubscribe: () => {},
    });
    client.updateCommand(channel.command);
    return { channel, client, topicsKey: "", unsubscribeBatches: () => {}, pendingSince: undefined, restarting: false, desired: undefined };
  }

  #dropEntry(topic: string): void {
    const entry = this.#entries.get(topic);
    if (entry == undefined) {
      return;
    }
    this.#entries.delete(topic);
    entry.unsubscribeBatches();
    // Stops the Stream only if this client started it.
    entry.client.close();
    this.#clearProblems(topic);
  }

  #desiredFor(channel: LynxChannelView): StreamRequestInput {
    const topic = channel.dataTopic!;
    const wanted = this.#panelWanted.get(topic) ?? [];
    const contents = deriveContents(wanted, dataFieldNames(channel.payloadSchema));
    return buildRequest(this.#settings.get(topic), contents);
  }

  #ensure(topic: string, entry: Entry): void {
    const { client, channel } = entry;
    const component = this.#network.component(channel.servicePath);
    const desired = this.#desiredFor(channel);
    entry.desired = desired;

    const command = client.currentCommand;
    if (command != undefined) {
      entry.pendingSince = undefined;
    }

    if (this.#paused.has(topic)) {
      this.#clearProblems(topic);
      return;
    }

    if (component?.connected !== true) {
      this.#setProblem(topic, "down", {
        severity: "warn",
        message: `${channel.title}: its component is not connected, so no data is arriving.`,
      });
      return;
    }
    this.#clearProblem(topic, "down");

    if (command == undefined) {
      this.#clearProblem(topic, "busy");
      this.#clearProblem(topic, "shared");
      this.#clearProblem(topic, "contents");
      if (entry.restarting || this.#pendingFresh(entry)) {
        return;
      }
      const outcome = client.startStream(desired);
      if (outcome.started) {
        entry.pendingSince = this.#now();
        this.#schedule(this.#pendingTimeoutMs + 50);
      } else if (outcome.reason === "unsupported") {
        this.#setProblem(topic, "unsupported", {
          severity: "warn",
          message: `${channel.title}: this Channel cannot stream.`,
        });
      }
      return;
    }
    this.#clearProblem(topic, "unsupported");

    if (command.command !== "Stream") {
      this.#setProblem(topic, "busy", {
        severity: "warn",
        message: `${channel.title}: busy with ${command.command}, so the dash cannot stream it.`,
      });
      return;
    }
    this.#clearProblem(topic, "busy");

    if (client.ownership === "own") {
      this.#clearProblem(topic, "shared");
      this.#clearProblem(topic, "contents");
      const same = stableJson(buildStreamPayload(desired)) === stableJson(command.payload ?? {});
      if (!same && !entry.restarting) {
        entry.restarting = true;
        void client.restart(desired).then((outcome) => {
          entry.restarting = false;
          if (outcome.started) {
            entry.pendingSince = this.#now();
            this.#schedule(this.#pendingTimeoutMs + 50);
          }
          this.refresh();
        });
      }
      return;
    }

    // Someone else's Stream: listen, and say so.
    const running = command.payload ?? {};
    this.#setProblem(topic, "shared", {
      severity: "info",
      message: `${channel.title}: sharing a Stream another consumer started (${describeRequest(running)}).`,
      tip: "Use the Channel's Stream settings to replace it with this dash's own settings.",
    });
    const missing = this.#missingFields(topic, channel, running);
    if (missing.length > 0) {
      this.#setProblem(topic, "contents", {
        severity: "warn",
        message: `${channel.title}: the shared Stream does not include ${missing.join(", ")}.`,
        tip: "Restart the Stream from the Channel's Stream settings to include every plotted field.",
      });
    } else {
      this.#clearProblem(topic, "contents");
    }
  }

  /** The fields panels plot that the running request leaves out. */
  #missingFields(topic: string, channel: LynxChannelView, running: Record<string, unknown>): string[] {
    const contents = running.contents;
    if (contents == undefined || contents === true) {
      return [];
    }
    if (contents === false || typeof contents !== "object") {
      return ["any field"];
    }
    const available = dataFieldNames(channel.payloadSchema) ?? [];
    const included = new Set(Object.keys(contents));
    const wanted = this.#panelWanted.get(topic) ?? [];
    const missing = new Set<string>();
    for (const fields of wanted) {
      if (fields == undefined) {
        return available.filter((name) => !included.has(name));
      }
      for (const field of fields) {
        if (available.includes(field) && !included.has(field)) {
          missing.add(field);
        }
      }
    }
    return [...missing].sort();
  }

  #pendingFresh(entry: Entry): boolean {
    return entry.pendingSince != undefined && this.#now() - entry.pendingSince < this.#pendingTimeoutMs;
  }

  /** Look again shortly, for a request that may need to be sent again if no answer comes. */
  #schedule(ms: number): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      this.refresh();
    }, ms);
    this.#timers.add(timer);
  }

  #problemKey(topic: string, kind: string): string {
    return `lynx:${kind}:${topic}`;
  }

  #setProblem(topic: string, kind: string, problem: LynxHubProblem): void {
    const key = this.#problemKey(topic, kind);
    const before = this.#problems.get(key);
    if (before?.message === problem.message && before.severity === problem.severity) {
      return;
    }
    this.#problems.set(key, problem);
    for (const listener of [...this.#problemListeners]) {
      listener(key, problem);
    }
  }

  #clearProblem(topic: string, kind: string): void {
    const key = this.#problemKey(topic, kind);
    if (this.#problems.delete(key)) {
      for (const listener of [...this.#problemListeners]) {
        listener(key, undefined);
      }
    }
  }

  #clearProblems(topic: string): void {
    for (const kind of ["down", "busy", "shared", "contents", "unsupported"]) {
      this.#clearProblem(topic, kind);
    }
  }

  #publishState(): void {
    const parts: string[] = [];
    const topics = new Set<string>([...this.#entries.keys(), ...this.#panelWanted.keys(), ...this.#manual, ...this.#paused]);
    for (const topic of [...topics].sort()) {
      parts.push(`${topic}=${stableJson(this.runtime(topic))}`);
    }
    const signature = parts.join("|");
    if (signature === this.#signature) {
      return;
    }
    this.#signature = signature;
    this.#version += 1;
    for (const listener of [...this.#stateListeners]) {
      listener();
    }
  }
}

/** A short description of a Stream request, for messages. */
export function describeRequest(request: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push(typeof request.sampleInterval === "number" ? `every ${request.sampleInterval} s` : "every 1 s");
  const batch = request.batch;
  if (typeof batch === "object" && batch != undefined) {
    const { maxSamples, maxInterval } = batch as Record<string, unknown>;
    if (typeof maxSamples === "number") {
      parts.push(`${maxSamples} per message`);
    }
    if (typeof maxInterval === "number") {
      parts.push(`flush ${maxInterval} s`);
    }
  }
  const contents = request.contents;
  if (typeof contents === "object" && contents != undefined) {
    parts.push(`fields ${Object.keys(contents).join(", ")}`);
  }
  return parts.join(", ");
}
