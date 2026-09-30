// SPDX-License-Identifier: MPL-2.0

import type { ChannelCommand, ChannelTopics } from "lynx-sdk-typescript";

export { LYNX_A3_VERSION as LYNX_PROTOCOL_VERSION } from "lynx-sdk-typescript";

export type JsonSchema = Record<string, unknown>;

export type LynxEndpointDirection = "sub" | "pub" | "pubsub";

/** One entry of an About's `endpoints` map; the key is the complete topic. */
export interface LynxEndpointAbout {
  endpoint_direction: LynxEndpointDirection;
  description?: string;
  payload_schema?: JsonSchema | null;
  /** Complete topics a command or query may answer on (A3.0 section 5). */
  replyTopics?: string[];
  /** Whether handling a command may publish on the Channel's `<`. */
  dataOutput?: boolean;
}

/**
 * A Channel as the dash shows it. `key` is its structural key inside the Service's `channels`
 * map; `name` is its deployed name, which is the topic segment (they may differ).
 */
export interface LynxChannelView {
  kind: "channel";
  servicePath: string;
  key: string;
  name: string;
  title: string;
  description: string;
  /** Complete topics in the dash's frame, or undefined for a Channel that has no `<`. */
  topics: ChannelTopics | undefined;
  /** The topic the Channel publishes its samples on; undefined if it does not publish. */
  dataTopic: string | undefined;
  /** The topic prefix of every endpoint of this Channel (`dataTopic` without `/<`). */
  base: string;
  endpoints: Record<string, LynxEndpointAbout>;
  /** The `<` payload schema: an array of `{ s, ns, data }`. */
  payloadSchema: JsonSchema | undefined;
  /** The `!/Stream` request schema, which says which stream settings the Channel accepts. */
  streamRequestSchema: JsonSchema | undefined;
  /** `status.command`: what the Channel is doing now, or null when idle. */
  command: ChannelCommand | null;
  config: Record<string, unknown>;
}

export type LynxComponentKind = "service" | "node";

export interface LynxComponentView {
  kind: LynxComponentKind;
  /** The component's path in the dash's frame; also its topic prefix. */
  path: string;
  /** The deployed name: the last segment of the path. */
  name: string;
  /** Path of the Node it was observed beneath, if any. */
  parentPath: string | undefined;
  title: string;
  description: string;
  /** `component.name`: who wrote it. */
  componentName: string;
  lynxVersion: string;
  timeSource: string | undefined;
  /** From the retained `@/Status`; undefined until one has been seen. */
  connected: boolean | undefined;
  /** Down, beneath a down Node, or its About is being refreshed. */
  stale: boolean;
  /** No About has arrived yet. */
  loading: boolean;
  generation: number | undefined;
  noticeLevel: number | undefined;
  /** Whether it advertises `?/Sync`. */
  supportsSync: boolean;
  endpoints: Record<string, LynxEndpointAbout>;
  channels: Record<string, LynxChannelView>;
  /** For a Node: the deployed names of the components it lists in its own About. */
  listedServices: string[];
  listedNodes: string[];
}

/** A component the dash sees but cannot use, such as one that speaks a pre-A3 protocol. */
export interface LynxUnsupportedView {
  path: string;
  reason: string;
}

export interface LynxNoticeEntry {
  path: string;
  receivedAt: number;
  severity: number;
  action: string;
  message: string;
  data: Record<string, unknown>;
}

export interface LynxNetworkSnapshot {
  /** Bumped whenever anything in the snapshot changed. */
  version: number;
  components: Record<string, LynxComponentView>;
  /** Paths with no observed parent, sorted. */
  roots: string[];
  childrenOf: Record<string, string[]>;
  unsupported: LynxUnsupportedView[];
}

export const EMPTY_NETWORK_SNAPSHOT: LynxNetworkSnapshot = {
  version: 0,
  components: {},
  roots: [],
  childrenOf: {},
  unsupported: [],
};

/** Notice severities as published (A3.0 section 14.1). */
export const NOTICE_SEVERITY_NAMES: Record<number, string> = {
  1: "trace",
  2: "info",
  3: "warning",
  4: "error",
};

/** The Channel that publishes on `dataTopic`, in a snapshot. */
export function findChannelByDataTopic(snapshot: LynxNetworkSnapshot, dataTopic: string): LynxChannelView | undefined {
  for (const component of Object.values(snapshot.components)) {
    for (const channel of Object.values(component.channels)) {
      if (channel.dataTopic === dataTopic) {
        return channel;
      }
    }
  }
  return undefined;
}

export function isChannelDataTopic(topic: string): boolean {
  return topic.endsWith("/<") && topic.length > 2;
}

/** The topic prefix of the Channel that publishes on `dataTopic`. */
export function channelBaseOfDataTopic(dataTopic: string): string {
  return dataTopic.slice(0, -2);
}

export const LYNX_CHANNEL_SCHEMA_NAME = "lynx/ChannelSample";

/** Per-Channel schema name for Lichtblick topics derived from an About. */
export function lynxChannelSchemaName(servicePath: string, channelKey: string): string {
  return `lynx/${servicePath}/${channelKey}`;
}
