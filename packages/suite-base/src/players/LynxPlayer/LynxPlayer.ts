// SPDX-License-Identifier: MPL-2.0

import type { InboundMessage } from "lynx-sdk-typescript";
import { v4 as uuidv4 } from "uuid";

import { fromMillis, type Time } from "@lichtblick/rostime";
import { ParameterValue } from "@lichtblick/suite";
import { LynxMqttManager } from "@lichtblick/suite-base/lynx/LynxMqttManager";
import { LynxNetworkStateTracker } from "@lichtblick/suite-base/lynx/LynxNetworkState";
import { LynxServiceIdentity } from "@lichtblick/suite-base/lynx/LynxServiceIdentity";
import { resolveBrokerUrl } from "@lichtblick/suite-base/lynx/lynxConf";
import { jsonSchemaToMessageDefs } from "@lichtblick/suite-base/lynx/jsonSchemaToMessageDefinition";
import { lynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import {
  LYNX_ABOUT_MONITOR_TOPIC,
  LYNX_CHANNEL_SCHEMA_NAME,
  lynxChannelSchemaName,
  parseLynxChannelTopic,
  type LynxChannelSample,
} from "@lichtblick/suite-base/lynx/types";
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
  #datatypes: RosDatatypes = new Map();
  #parsedMessages: MessageEvent[] = [];
  #receivedBytes = 0;
  #requestedSubscriptions: SubscribePayload[] = [];
  #activeStreams = new Set<string>();
  #streamStartTime: Time = fromMillis(Date.now());
  #urlState: PlayerState["urlState"];
  #emitTimer?: ReturnType<typeof setTimeout>;

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
    void this.#emitState();
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
    void this.#emitState();
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

      this.#mqtt.addMessageHandler(LYNX_ABOUT_MONITOR_TOPIC, (msg) => {
        this.#networkState?.updateFromAboutMessage(msg);
        this.#rebuildTopics();
        void this.#emitState();
      });

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
      void this.#emitState();
    } catch (err: unknown) {
      this.#presence = PlayerPresence.ERROR;
      this.#alerts.addAlert("lynx:connection-failed", {
        severity: "error",
        message: "Failed to connect to Lynx broker",
        error: err instanceof Error ? err : new Error(String(err)),
        tip: "Verify the WebSocket URL and that the MQTT broker is reachable.",
      });
      void this.#emitState();
    }
  }

  #rebuildTopics(): void {
    if (!this.#networkState) {
      return;
    }
    const channelEntries = this.#networkState.listChannelTopicsWithSchema();
    const topics: Topic[] = [];
    const topicSchemaMap = new Map<string, string>();
    const datatypes: RosDatatypes = new Map();

    for (const entry of channelEntries) {
      const schemaName = lynxChannelSchemaName(entry.serviceId, entry.channelId);
      topics.push({ name: entry.topic, schemaName });
      topicSchemaMap.set(entry.topic, schemaName);

      if (entry.payloadSchema != undefined) {
        const { definitions, nested } = jsonSchemaToMessageDefs(schemaName, entry.payloadSchema);
        datatypes.set(schemaName, { name: schemaName, definitions });
        for (const [nestedName, nestedDef] of nested) {
          datatypes.set(nestedName, nestedDef);
        }
      } else {
        datatypes.set(schemaName, { name: schemaName, definitions: [] });
      }
    }

    this.#topics = topics;
    this.#topicSchemaMap = topicSchemaMap;
    this.#datatypes = datatypes;
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

  #handleChannelOutput(topic: string, msg: InboundMessage): void {
    const baseTime = messageBaseTime(msg);
    const raw: unknown = msg.payload;
    const samples: LynxChannelSample[] = Array.isArray(raw)
      ? (raw as LynxChannelSample[])
      : LynxMqttManager.parseChannelOutput(
          typeof raw === "object" && raw != null ? (raw as Record<string, unknown>) : {},
        );

    for (const sample of samples) {
      const receiveTime = sampleToReceiveTime(sample, baseTime);
      const messageEvent: MessageEvent = {
        topic,
        receiveTime,
        message: sample.data,
        schemaName: this.#topicSchemaMap.get(topic) ?? LYNX_CHANNEL_SCHEMA_NAME,
        sizeInBytes: (JSON.stringify(sample.data ?? {}) ?? "").length,
      };
      this.#parsedMessages.push(messageEvent);
      this.#receivedBytes += messageEvent.sizeInBytes ?? 0;

      let stats = this.#topicStats.get(topic);
      if (!stats) {
        stats = { numMessages: 0 };
        this.#topicStats.set(topic, stats);
      }
      stats.numMessages = (stats.numMessages ?? 0) + 1;
    }
    this.#scheduleEmit();
  }

  #scheduleEmit(): void {
    if (this.#emitTimer != undefined) {
      return;
    }
    this.#emitTimer = setTimeout(() => {
      this.#emitTimer = undefined;
      void this.#emitState();
    }, 50);
  }

  async #emitState(): Promise<void> {
    if (!this.#listener) {
      return;
    }
    const currentTime = fromMillis(Date.now());
    const messages = this.#parsedMessages;
    this.#parsedMessages = [];

    await this.#listener({
      presence: this.#presence,
      progress: {},
      capabilities: [],
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
              topicStats: new Map(this.#topicStats),
              datatypes: this.#datatypes,
            }
          : undefined,
    });
  }
}
