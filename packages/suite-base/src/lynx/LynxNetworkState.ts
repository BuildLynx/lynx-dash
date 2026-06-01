// SPDX-License-Identifier: MPL-2.0

import { NetworkState, type InboundMessage } from "lynx-sdk-typescript";

import { extractChannelOutputPayloadSchema } from "@lichtblick/suite-base/lynx/jsonSchemaToMessageDefinition";
import type {
  JsonSchema,
  LynxChannelAbout,
  LynxNetworkStateRoot,
  LynxNodeAbout,
  LynxServiceAbout,
} from "@lichtblick/suite-base/lynx/types";

export type LynxNetworkStateListener = (state: LynxNetworkStateRoot) => void;

export interface LynxChannelTopicInfo {
  topic: string;
  serviceId: string;
  channelId: string;
  channel: LynxChannelAbout;
  payloadSchema?: JsonSchema;
}

function normalizeWireAbout(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...payload };
  if ("child_nodes" in normalized && !("childNodes" in normalized)) {
    normalized.childNodes = normalized.child_nodes;
    delete normalized.child_nodes;
  }
  return normalized;
}

function emptyRoot(): LynxNetworkStateRoot {
  return { services: {}, childNodes: {} };
}

export class LynxNetworkStateTracker {
  readonly #sdkState: NetworkState;
  #root: LynxNetworkStateRoot = emptyRoot();
  readonly #listeners = new Set<LynxNetworkStateListener>();

  public constructor() {
    this.#sdkState = new NetworkState();
  }

  public get state(): LynxNetworkStateRoot {
    return this.#root;
  }

  public subscribe(listener: LynxNetworkStateListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public updateFromAboutMessage(msg: InboundMessage): void {
    const normalizedPayload = normalizeWireAbout(msg.payload);
    const normalizedMsg: InboundMessage = { ...msg, payload: normalizedPayload };
    this.#sdkState.updateFromAboutMessage(normalizedMsg);
    const sdkRoot = this.#sdkState.state as unknown as LynxNetworkStateRoot;
    this.#root = { ...sdkRoot, services: { ...sdkRoot.services }, childNodes: { ...sdkRoot.childNodes } };
    this.#notify();
  }

  public reset(): void {
    this.#sdkState.state = NetworkState.generateEmptyNodeState();
    this.#root = emptyRoot();
    this.#notify();
  }

  #forEachChannel(visitor: (info: LynxChannelTopicInfo) => void): void {
    const visitServices = (services: Record<string, LynxServiceAbout>) => {
      for (const [serviceId, service] of Object.entries(services)) {
        if (service == undefined) {
          continue;
        }
        const channels = service.channels ?? {};
        for (const [channelId, channel] of Object.entries(channels)) {
          if (channel == undefined) {
            continue;
          }
          const topic = `${serviceId}/${channelId}`;
          const payloadSchema = extractChannelOutputPayloadSchema(serviceId, channelId, channel);
          visitor({ topic, serviceId, channelId, channel, payloadSchema });
        }
      }
    };

    visitServices(this.#root.services);
    const visitNodes = (nodes: Record<string, LynxNetworkStateRoot>) => {
      for (const node of Object.values(nodes)) {
        visitServices(node.services);
        visitNodes(node.childNodes);
      }
    };
    visitNodes(this.#root.childNodes);
  }

  public listChannelTopics(): string[] {
    const topics: string[] = [];
    this.#forEachChannel((info) => {
      topics.push(info.topic);
    });
    return topics.sort();
  }

  public listChannelTopicsWithSchema(): LynxChannelTopicInfo[] {
    const entries: LynxChannelTopicInfo[] = [];
    this.#forEachChannel((info) => {
      entries.push(info);
    });
    return entries.sort((a, b) => a.topic.localeCompare(b.topic));
  }

  public getChannelAbout(serviceId: string, channelId: string): LynxChannelAbout | undefined {
    let found: LynxChannelAbout | undefined;
    this.#forEachChannel((info) => {
      if (info.serviceId === serviceId && info.channelId === channelId) {
        found = info.channel;
      }
    });
    return found;
  }

  public getServiceAbout(serviceId: string): LynxServiceAbout | undefined {
    const topLevel = this.#root.services[serviceId];
    if (topLevel != undefined) {
      return topLevel;
    }

    const findInNodes = (nodes: Record<string, LynxNetworkStateRoot>): LynxServiceAbout | undefined => {
      for (const node of Object.values(nodes)) {
        const service = node.services[serviceId];
        if (service != undefined) {
          return service;
        }
        const nested = findInNodes(node.childNodes);
        if (nested != undefined) {
          return nested;
        }
      }
      return undefined;
    };
    return findInNodes(this.#root.childNodes);
  }

  public getNodeAbout(nodeId: string): LynxNodeAbout | undefined {
    const findInNodes = (
      nodes: Record<string, LynxNetworkStateRoot>,
    ): LynxNodeAbout | undefined => {
      for (const [id, nodeState] of Object.entries(nodes)) {
        if (id === nodeId) {
          return {
            lynxType: "Node",
            docs: {
              id,
              title: id,
              description: "",
              lynx_version: "A-01.01",
            },
            status: { state: "idle" },
            services: nodeState.services,
            child_nodes: nodeState.childNodes as unknown as Record<string, LynxNodeAbout>,
          };
        }
        const nested = findInNodes(nodeState.childNodes);
        if (nested) {
          return nested;
        }
      }
      return undefined;
    };
    return findInNodes(this.#root.childNodes);
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener(this.#root);
    }
  }
}
