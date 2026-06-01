// SPDX-License-Identifier: MPL-2.0

import type { InboundMessage } from "lynx-sdk-typescript";
import { v4 as uuidv4 } from "uuid";

import { debouncePromise } from "@lichtblick/den/async";
import { fromMillis, type Time } from "@lichtblick/rostime";
import { ParameterValue } from "@lichtblick/suite";
import { LynxMqttManager } from "@lichtblick/suite-base/lynx/LynxMqttManager";
import { LynxNetworkStateTracker } from "@lichtblick/suite-base/lynx/LynxNetworkState";
import { LynxServiceIdentity } from "@lichtblick/suite-base/lynx/LynxServiceIdentity";
import { resolveBrokerUrl } from "@lichtblick/suite-base/lynx/lynxConf";
import {
  buildChannelPayloadSchemaFromData,
  jsonSchemaToMessageDefs,
} from "@lichtblick/suite-base/lynx/jsonSchemaToMessageDefinition";
import { lynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import {
  LYNX_ABOUT_MONITOR_TOPIC,
  LYNX_CHANNEL_ABOUT_MONITOR_TOPIC,
  LYNX_CHANNEL_SCHEMA_NAME,
  lynxChannelSchemaName,
  parseLynxChannelTopic,
  type JsonSchema,
  type LynxChannelSample,
} from "@lichtblick/suite-base/lynx/types";
import { CURRENT_FRAME_MAXIMUM_SIZE_BYTES } from "@lichtblick/suite-base/players/FoxgloveWebSocketPlayer/constants";
import { estimateObjectSize } from "@lichtblick/suite-base/players/messageMemoryEstimation";
import PlayerAlertManager from "@lichtblick/suite-base/players/PlayerAlertManager";
import {
  AdvertiseOptions,
  MessageEvent,
  Player,
  PlayerMetricsCollectorInterface,
  PlayerPresence,
  PlayerState,
  PublishPayload,
  SubscribePayload,
  Topic,
  TopicStats,
} from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

const LYNX_PROFILE = "lynx";
const EMPTY_PROGRESS: PlayerState["progress"] = {};
const EMPTY_CAPABILITIES: PlayerState["capabilities"] = [];

/** MQTT message base time from user-property s/ns, or dashboard receive time. */
function messageBaseTime(msg: Pick<InboundMessage, "sec" | "nsec">): Time {
  if (msg.sec != undefined && msg.nsec != undefined) {
    return { sec: msg.sec, nsec: msg.nsec };
  }
  return fromMillis(Date.now());
}

function sampleToReceiveTime(sample: LynxChannelSample, baseTime: Time): Time {
  const relNs = sample.s * 1e9 + sample.ns;
  const baseNs = baseTime.sec * 1e9 + baseTime.nsec;
  const totalNs = baseNs + relNs;
  const sec = Math.floor(totalNs / 1e9);
  const nsec = totalNs % 1e9;
  return { sec, nsec };
}

function channelTopicsFingerprint(
  entries: ReturnType<LynxNetworkStateTracker["listChannelTopicsWithSchema"]>,
): string {
  return entries
    .map((e) => {
      const schemaKey =
        e.payloadSchema != undefined ? JSON.stringify(e.payloadSchema) : "";
      return `${e.topic}\0${schemaKey}`;
    })
    .join("\n");
}

export default class LynxPlayer implements Player {
  readonly #brokerUrlInput: string;
  readonly #serviceId: string;
  readonly #metricsCollector: PlayerMetricsCollectorInterface;
  readonly #id = uuidv4();

  #listener?: (state: PlayerState) => Promise<void>;
  #closed = false;
  #presence: PlayerPresence = PlayerPresence.INITIALIZING;
  #alerts = new PlayerAlertManager();
  #mqtt?: LynxMqttManager;
  #networkState?: LynxNetworkStateTracker;
  #serviceIdentity?: LynxServiceIdentity;
  #topics: Topic[] = [];
  #topicSchemaMap = new Map<string, string>();
  #topicStats = new Map<string, TopicStats>();
  #cachedTopicStats = new Map<string, TopicStats>();
  #topicStatsDirty = false;
  #datatypes: RosDatatypes = new Map();
  /** Schemas inferred from live `<` output when About omits payload_schema. */
  #inferredPayloadSchemas = new Map<string, JsonSchema>();
  #parsedMessages: MessageEvent[] = [];
  #parsedMessagesBytes = 0;
  #messageSizeEstimateByTopic: Record<string, number> = {};
  #receivedBytes = 0;
  #requestedSubscriptions: SubscribePayload[] = [];
  #activeStreams = new Set<string>();
  #streamStartTime: Time = fromMillis(Date.now());
  #urlState: PlayerState["urlState"];
  #emitTimer?: ReturnType<typeof setTimeout>;
  #topicsFingerprint?: string;
  #schemaDefsCache = new Map<
    string,
    ReturnType<typeof jsonSchemaToMessageDefs>
  >();
  #topicsInferred = new Set<string>();

  public constructor(args: {
    brokerUrl: string;
    serviceId: string;
    metricsCollector: PlayerMetricsCollectorInterface;
    sourceId: string;
  }) {
    this.#brokerUrlInput = args.brokerUrl;
    this.#serviceId = args.serviceId;
    this.#metricsCollector = args.metricsCollector;
    this.#urlState = {
      sourceId: args.sourceId,
      parameters: { url: args.brokerUrl, serviceId: args.serviceId },
    };
    this.#metricsCollector.playerConstructed();
    void this.#connect();
  }

  public setListener(listener: (arg0: PlayerState) => Promise<void>): void {
    this.#listener = listener;
    this.#emitState();
  }

  public close(): void {
    this.#closed = true;
    if (this.#emitTimer != undefined) {
      clearTimeout(this.#emitTimer);
      this.#emitTimer = undefined;
    }
    for (const topic of this.#activeStreams) {
      const ref = parseLynxChannelTopic(topic);
      if (ref && this.#mqtt) {
        this.#mqtt.stopStream(ref.serviceId, ref.channelId);
      }
    }
    this.#activeStreams.clear();
    this.#mqtt?.disconnect();
    lynxRuntimeStore.getState().clearRuntime();
    this.#presence = PlayerPresence.NOT_PRESENT;
    this.#emitState();
  }

  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    this.#requestedSubscriptions = [...subscriptions];
    if (!this.#mqtt || this.#presence !== PlayerPresence.PRESENT) {
      return;
    }
    this.#syncStreams();
  }

  public setPublishers(_publishers: AdvertiseOptions[]): void {
    // Lynx Dash does not publish arbitrary topics through the player yet.
  }

  public setParameter(_key: string, _value: ParameterValue): void {
    // Not supported for Lynx live connection.
  }

  public publish(_request: PublishPayload): void {
    // Not supported for Lynx live connection.
  }

  public callService(_service: string, _request: unknown): Promise<unknown> {
    return Promise.reject(new Error("Lynx player does not support service calls"));
  }

  public setGlobalVariables(): void {
    // No-op.
  }

  public getBatchIterator(): undefined {
    return undefined;
  }

  async #connect(): Promise<void> {
    if (this.#closed) {
      return;
    }

    try {
      const brokerUrl = await resolveBrokerUrl(this.#brokerUrlInput);
      const clientId = `${this.#serviceId}-${this.#id.slice(0, 8)}`;
      this.#mqtt = new LynxMqttManager(clientId);
      this.#networkState = new LynxNetworkStateTracker();
      this.#serviceIdentity = new LynxServiceIdentity(this.#mqtt, {
        serviceId: this.#serviceId,
      });

      await this.#mqtt.connect(brokerUrl, this.#serviceId);

      const onAboutMessage = (msg: InboundMessage): void => {
        this.#networkState?.updateFromAboutMessage(msg);
        lynxRuntimeStore.getState().setRuntime({
          networkStateRoot: this.#networkState!.state,
        });
        const topicsChanged = this.#rebuildTopics();
        if (topicsChanged) {
          this.#scheduleEmit();
        }
      };
      this.#mqtt.addMessageHandler(LYNX_ABOUT_MONITOR_TOPIC, onAboutMessage);
      this.#mqtt.addMessageHandler(LYNX_CHANNEL_ABOUT_MONITOR_TOPIC, onAboutMessage);

      this.#serviceIdentity.register();
      this.#streamStartTime = fromMillis(Date.now());
      this.#presence = PlayerPresence.PRESENT;

      lynxRuntimeStore.getState().setRuntime({
        connected: true,
        brokerUrl,
        serviceId: this.#serviceId,
        mqtt: this.#mqtt,
        networkState: this.#networkState,
        serviceIdentity: this.#serviceIdentity,
        networkStateRoot: this.#networkState.state,
      });

      this.#rebuildTopics();
      this.#syncStreams();
      this.#emitState();
    } catch (err: unknown) {
      this.#presence = PlayerPresence.ERROR;
      this.#alerts.addAlert("lynx:connection-failed", {
        severity: "error",
        message: "Failed to connect to Lynx broker",
        error: err instanceof Error ? err : new Error(String(err)),
        tip: "Verify the WebSocket URL and that the MQTT broker is reachable.",
      });
      this.#emitState();
    }
  }

  #setDatatypesFromPayloadSchema(
    datatypes: RosDatatypes,
    schemaName: string,
    payloadSchema: JsonSchema,
  ): void {
    const cacheKey = `${schemaName}\0${JSON.stringify(payloadSchema)}`;
    let cached = this.#schemaDefsCache.get(cacheKey);
    if (cached == undefined) {
      cached = jsonSchemaToMessageDefs(schemaName, payloadSchema);
      this.#schemaDefsCache.set(cacheKey, cached);
    }
    const { definitions, nested } = cached;
    datatypes.set(schemaName, { name: schemaName, definitions });
    for (const [nestedName, nestedDef] of nested) {
      datatypes.set(nestedName, nestedDef);
    }
  }

  /** Rebuild topics/datatypes when the channel list or schemas change. Returns true if anything changed. */
  #rebuildTopics(): boolean {
    if (!this.#networkState) {
      return false;
    }
    const channelEntries = this.#networkState.listChannelTopicsWithSchema();
    const fingerprint = channelTopicsFingerprint(channelEntries);
    if (fingerprint === this.#topicsFingerprint) {
      return false;
    }
    this.#topicsFingerprint = fingerprint;

    const topics: Topic[] = [];
    const topicSchemaMap = new Map<string, string>();
    const datatypes: RosDatatypes = new Map();

    for (const entry of channelEntries) {
      const schemaName = lynxChannelSchemaName(entry.serviceId, entry.channelId);
      topics.push({ name: entry.topic, schemaName });
      topicSchemaMap.set(entry.topic, schemaName);

      const payloadSchema =
        entry.payloadSchema ?? this.#inferredPayloadSchemas.get(entry.topic);
      if (payloadSchema != undefined) {
        this.#setDatatypesFromPayloadSchema(datatypes, schemaName, payloadSchema);
      } else {
        datatypes.set(schemaName, { name: schemaName, definitions: [] });
      }
    }

    this.#topics = topics;
    this.#topicSchemaMap = topicSchemaMap;
    this.#datatypes = datatypes;
    return true;
  }

  #maybeInferDatatypesFromSample(topic: string, data: Record<string, unknown>): void {
    if (this.#topicsInferred.has(topic)) {
      return;
    }
    const schemaName = this.#topicSchemaMap.get(topic);
    if (schemaName == undefined) {
      return;
    }
    const existing = this.#datatypes.get(schemaName);
    if ((existing?.definitions.length ?? 0) > 0) {
      this.#topicsInferred.add(topic);
      return;
    }

    const payloadSchema = buildChannelPayloadSchemaFromData(data);
    const { definitions } = jsonSchemaToMessageDefs(schemaName, payloadSchema);
    if (definitions.length === 0) {
      return;
    }

    this.#topicsInferred.add(topic);
    this.#inferredPayloadSchemas.set(topic, payloadSchema);
    this.#setDatatypesFromPayloadSchema(this.#datatypes, schemaName, payloadSchema);
    this.#topicsFingerprint = undefined;
    this.#scheduleEmit();
  }

  #syncStreams(): void {
    if (!this.#mqtt) {
      return;
    }
    const wanted = new Set(this.#requestedSubscriptions.map((s) => s.topic));
    for (const topic of wanted) {
      if (this.#activeStreams.has(topic)) {
        continue;
      }
      const ref = parseLynxChannelTopic(topic);
      if (!ref) {
        continue;
      }
      this.#activeStreams.add(topic);
      this.#mqtt.startStream(ref.serviceId, ref.channelId, {}, (msg) => {
        this.#handleChannelOutput(ref.topic, msg);
      });
    }
    for (const topic of [...this.#activeStreams]) {
      if (!wanted.has(topic)) {
        const ref = parseLynxChannelTopic(topic);
        if (ref) {
          this.#mqtt.stopStream(ref.serviceId, ref.channelId);
        }
        this.#activeStreams.delete(topic);
      }
    }
  }

  #evictParsedMessagesIfNeeded(): void {
    if (this.#parsedMessagesBytes <= CURRENT_FRAME_MAXIMUM_SIZE_BYTES) {
      return;
    }
    this.#alerts.addAlert("lynx:parsedMessageCacheFull", {
      severity: "error",
      message: `Lynx player maximum frame size (${(
        CURRENT_FRAME_MAXIMUM_SIZE_BYTES / 1_000_000
      ).toFixed(
        2,
      )}MB) reached. Dropping old messages. This can occur if the browser tab has been inactive.`,
    });
    const evictUntilSize = 0.8 * CURRENT_FRAME_MAXIMUM_SIZE_BYTES;
    let droppedBytes = 0;
    let indexToCutBefore = 0;
    while (this.#parsedMessagesBytes - droppedBytes > evictUntilSize) {
      droppedBytes += this.#parsedMessages[indexToCutBefore]!.sizeInBytes ?? 0;
      indexToCutBefore++;
    }
    this.#parsedMessages.splice(0, indexToCutBefore);
    this.#parsedMessagesBytes -= droppedBytes;
  }

  #handleChannelOutput(topic: string, msg: InboundMessage): void {
    const baseTime = messageBaseTime(msg);
    const raw: unknown = msg.payload;
    const wireBytes = msg.raw?.byteLength ?? 0;
    const samples: LynxChannelSample[] = Array.isArray(raw)
      ? (raw as LynxChannelSample[])
      : LynxMqttManager.parseChannelOutput(
          typeof raw === "object" && raw != null ? (raw as Record<string, unknown>) : {},
        );

    const perSampleWireBytes =
      samples.length > 0 ? Math.ceil(wireBytes / samples.length) : wireBytes;

    for (const sample of samples) {
      if (sample.data != undefined && typeof sample.data === "object" && !Array.isArray(sample.data)) {
        this.#maybeInferDatatypesFromSample(topic, sample.data as Record<string, unknown>);
      }

      let msgSizeEstimate = this.#messageSizeEstimateByTopic[topic];
      if (msgSizeEstimate == undefined) {
        msgSizeEstimate = estimateObjectSize(sample.data);
        this.#messageSizeEstimateByTopic[topic] = msgSizeEstimate;
      }
      const sizeInBytes = Math.max(perSampleWireBytes, msgSizeEstimate);

      const receiveTime = sampleToReceiveTime(sample, baseTime);
      const messageEvent: MessageEvent = {
        topic,
        receiveTime,
        message: sample.data,
        schemaName: this.#topicSchemaMap.get(topic) ?? LYNX_CHANNEL_SCHEMA_NAME,
        sizeInBytes,
      };
      this.#parsedMessages.push(messageEvent);
      this.#parsedMessagesBytes += sizeInBytes;
      this.#receivedBytes += sizeInBytes;

      let stats = this.#topicStats.get(topic);
      if (!stats) {
        stats = { numMessages: 0 };
        this.#topicStats.set(topic, stats);
      }
      stats.numMessages = (stats.numMessages ?? 0) + 1;
      this.#topicStatsDirty = true;
    }

    this.#evictParsedMessagesIfNeeded();
    this.#scheduleEmit();
  }

  #scheduleEmit(): void {
    if (this.#emitTimer != undefined) {
      return;
    }
    this.#emitTimer = setTimeout(() => {
      this.#emitTimer = undefined;
      this.#emitState();
    }, 50);
  }

  // Potentially performance-sensitive; await can be expensive
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  #emitState = debouncePromise(() => {
    if (!this.#listener || this.#closed) {
      return Promise.resolve();
    }

    const currentTime = fromMillis(Date.now());
    const messages = this.#parsedMessages;
    this.#parsedMessages = [];
    this.#parsedMessagesBytes = 0;

    if (this.#topicStatsDirty) {
      this.#cachedTopicStats = new Map(this.#topicStats);
      this.#topicStatsDirty = false;
    }

    return this.#listener({
      presence: this.#presence,
      progress: EMPTY_PROGRESS,
      capabilities: EMPTY_CAPABILITIES,
      profile: LYNX_PROFILE,
      playerId: this.#id,
      name: `Lynx (${this.#serviceId})`,
      alerts: this.#alerts.alerts(),
      urlState: this.#urlState,
      activeData:
        this.#presence === PlayerPresence.PRESENT
          ? {
              messages,
              totalBytesReceived: this.#receivedBytes,
              startTime: this.#streamStartTime,
              endTime: currentTime,
              currentTime,
              isPlaying: true,
              speed: 1,
              lastSeekTime: 1,
              topics: this.#topics,
              topicStats: this.#cachedTopicStats,
              datatypes: this.#datatypes,
            }
          : undefined,
    });
  });
}
