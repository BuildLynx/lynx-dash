// SPDX-License-Identifier: MPL-2.0

export const LYNX_PROTOCOL_VERSION = "A-01.01";

export type LynxComponentState = "idle" | "busy" | "disconnected" | "disabled";

export type LynxComponentType = "Service" | "Node" | "Channel";

export type JsonSchema = Record<string, unknown>;

export interface LynxDocs {
  id: string;
  title: string;
  description: string;
  lynx_version: string;
  time_source?: string;
}

export interface LynxAction {
  command: string;
  payload: Record<string, unknown>;
}

export interface LynxStatus {
  state: LynxComponentState;
  action?: LynxAction;
}

export interface LynxEndpointAbout {
  endpoint_direction: "sub" | "pub" | "pubsub";
  description?: string;
  payload_schema?: JsonSchema | null;
}

export interface LynxChannelAbout {
  lynxType: "Channel";
  docs: LynxDocs;
  config?: Record<string, unknown>;
  status: LynxStatus;
  endpoints?: Record<string, LynxEndpointAbout>;
}

export interface LynxServiceAbout {
  lynxType: "Service";
  docs: LynxDocs;
  config?: Record<string, unknown>;
  status: LynxStatus;
  endpoints?: Record<string, LynxEndpointAbout>;
  channels?: Record<string, LynxChannelAbout>;
}

export interface LynxNodeAbout {
  lynxType: "Node";
  docs: LynxDocs;
  config?: Record<string, unknown>;
  status: LynxStatus;
  endpoints?: Record<string, LynxEndpointAbout>;
  services?: Record<string, LynxServiceAbout>;
  child_nodes?: Record<string, LynxNodeAbout>;
}

export type LynxAboutPayload = LynxServiceAbout | LynxNodeAbout | LynxChannelAbout;

export interface LynxNetworkStateRoot {
  services: Record<string, LynxServiceAbout>;
  childNodes: Record<string, LynxNetworkStateRoot>;
}

export interface LynxChannelSample {
  s: number;
  ns: number;
  data: Record<string, unknown>;
}

export type LynxChannelOutput = LynxChannelSample[];

export interface LynxStreamRequest {
  contents?: boolean | Record<string, unknown>;
  interval?: number;
  numSamples?: number;
  paginate?: number;
}

export interface LynxPollRequest {
  contents?: boolean | Record<string, unknown>;
}

export interface LynxChannelTopicRef {
  serviceId: string;
  channelId: string;
  topic: string;
}

export function parseLynxChannelTopic(topic: string): LynxChannelTopicRef | undefined {
  const parts = topic.split("/");
  if (parts.length !== 3 || parts[0] === "" || parts[1] === "" || parts[2] !== "<") {
    return undefined;
  }
  const serviceId = parts[0]!;
  const channelId = parts[1]!;
  return { serviceId, channelId, topic };
}

export function channelOutputTopic(serviceId: string, channelId: string): string {
  return `${serviceId}/${channelId}/<`;
}

export function channelStreamTopic(serviceId: string, channelId: string): string {
  return `${serviceId}/${channelId}/!/Stream`;
}

export function channelStopTopic(serviceId: string, channelId: string): string {
  return `${serviceId}/${channelId}/!/Stop`;
}

export function serviceAboutTopic(serviceId: string): string {
  return `${serviceId}/@/About`;
}

export const LYNX_ABOUT_MONITOR_TOPIC = "+/@/About";

/** Per-channel About: `{serviceId}/{channelId}/@/About`. */
export const LYNX_CHANNEL_ABOUT_MONITOR_TOPIC = "+/+/@/About";

export const LYNX_CHANNEL_SCHEMA_NAME = "lynx/ChannelSample";

/** Per-channel schema name for Lichtblick topics derived from About. */
export function lynxChannelSchemaName(serviceId: string, channelId: string): string {
  return `lynx/${serviceId}/${channelId}`;
}
