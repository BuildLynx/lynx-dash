// SPDX-License-Identifier: MPL-2.0

import type { ChannelBatch } from "lynx-sdk-typescript";
import { v4 as uuidv4 } from "uuid";

import { debouncePromise } from "@lichtblick/den/async";
import { fromMillis, type Time } from "@lichtblick/rostime";
import { ParameterValue } from "@lichtblick/suite";
import type { LynxWantedFields } from "@lichtblick/suite-base/lynx/LynxChannelHub";
import { LynxSession } from "@lichtblick/suite-base/lynx/LynxSession";
import {
  buildChannelPayloadSchemaFromData,
  jsonSchemaToMessageDefs,
} from "@lichtblick/suite-base/lynx/jsonSchemaToMessageDefinition";
import { resolveBrokerUrl } from "@lichtblick/suite-base/lynx/lynxConf";
import { lynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import {
  LYNX_CHANNEL_SCHEMA_NAME,
  NOTICE_SEVERITY_NAMES,
  isChannelDataTopic,
  lynxChannelSchemaName,
  type JsonSchema,
  type LynxChannelView,
  type LynxNoticeEntry,
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
/** How long a Notice stays on the alerts list. */
const NOTICE_ALERT_MS = 60_000;

function toTime(seconds: number, nanoseconds: number): Time {
  return { sec: seconds, nsec: nanoseconds };
}

/** A sample cannot be from the future: with the publisher's clock ahead of ours, hold it at "now". */
function clampToNow(time: Time, nowMs: number): Time {
  return time.sec * 1000 + time.nsec / 1e6 > nowMs ? fromMillis(nowMs) : time;
}

function topicsFingerprint(channels: readonly LynxChannelView[], inferred: ReadonlyMap<string, JsonSchema>): string {
  return channels
    .map((channel) => {
      const schema = channel.payloadSchema ?? (channel.dataTopic != undefined ? inferred.get(channel.dataTopic) : undefined);
      return `${channel.dataTopic ?? ""}\0${schema != undefined ? JSON.stringify(schema) : ""}`;
    })
    .join("\n");
}

export default class LynxPlayer implements Player {
  readonly #brokerUrlInput: string;
  readonly #deploymentNameInput: string | undefined;
  readonly #metricsCollector: PlayerMetricsCollectorInterface;
  readonly #id = uuidv4();

  #listener?: (state: PlayerState) => Promise<void>;
  #closed = false;
  #presence: PlayerPresence = PlayerPresence.INITIALIZING;
  #alerts = new PlayerAlertManager();
  #session?: LynxSession;
  #unsubscribers: Array<() => void> = [];
  #noticeTimers = new Set<ReturnType<typeof setTimeout>>();
  #topics: Topic[] = [];
  #topicSchemaMap = new Map<string, string>();
  #topicStats = new Map<string, TopicStats>();
  #cachedTopicStats = new Map<string, TopicStats>();
  #topicStatsDirty = false;
  #datatypes: RosDatatypes = new Map();
  /** Schemas inferred from live samples when an About omits the `<` payload schema. */
  #inferredPayloadSchemas = new Map<string, JsonSchema>();
  #parsedMessages: MessageEvent[] = [];
  #parsedMessagesBytes = 0;
  #messageSizeEstimateByTopic: Record<string, number> = {};
  #receivedBytes = 0;
  #requestedSubscriptions: SubscribePayload[] = [];
  #streamStartTime: Time = fromMillis(Date.now());
  #urlState: PlayerState["urlState"];
  #emitTimer?: ReturnType<typeof setTimeout>;
  #topicsFingerprint?: string;
  #schemaDefsCache = new Map<string, ReturnType<typeof jsonSchemaToMessageDefs>>();
  #topicsInferred = new Set<string>();

  public constructor(args: {
    brokerUrl: string;
    /** The dash's deployed name on the network, if the user chose one. Generated per tab otherwise. */
    deploymentName?: string;
    metricsCollector: PlayerMetricsCollectorInterface;
    sourceId: string;
  }) {
    this.#brokerUrlInput = args.brokerUrl;
    this.#deploymentNameInput = args.deploymentName;
    this.#metricsCollector = args.metricsCollector;
    this.#urlState = {
      sourceId: args.sourceId,
      parameters: {
        url: args.brokerUrl,
        ...(args.deploymentName != undefined && args.deploymentName !== "" ? { deploymentName: args.deploymentName } : {}),
      },
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
    for (const timer of this.#noticeTimers) {
      clearTimeout(timer);
    }
    this.#noticeTimers.clear();
    for (const unsubscribe of this.#unsubscribers) {
      unsubscribe();
    }
    this.#unsubscribers = [];
    // Stops the Streams this dash started; another consumer's Stream is left running.
    void this.#session?.stop();
    lynxRuntimeStore.getState().clearRuntime();
    this.#presence = PlayerPresence.NOT_PRESENT;
    this.#emitState();
  }

  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    this.#requestedSubscriptions = [...subscriptions];
    this.#applyWanted();
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
      const session = await LynxSession.create({
        brokerUrl,
        deploymentName: this.#deploymentNameInput,
      });
      if (this.#closed) {
        void session.stop();
        return;
      }
      this.#session = session;

      this.#unsubscribers.push(
        session.network.subscribe((snapshot) => {
          lynxRuntimeStore.getState().setRuntime({ network: snapshot });
          if (this.#rebuildTopics()) {
            this.#scheduleEmit();
          }
        }),
        session.network.onNotice((notice) => {
          this.#showNotice(notice);
        }),
        session.network.onProblem((path, message) => {
          this.#alerts.addAlert(`lynx:problem:${path}`, {
            severity: "warn",
            message: `${path}: ${message}`,
          });
          this.#scheduleEmit();
        }),
        session.hub.onBatch((channel, batch) => {
          this.#handleBatch(channel, batch);
        }),
        session.hub.onProblem((key, problem) => {
          if (problem == undefined) {
            this.#alerts.removeAlert(key);
          } else {
            this.#alerts.addAlert(key, { severity: problem.severity, message: problem.message, tip: problem.tip });
          }
          this.#scheduleEmit();
        }),
      );

      await session.start();
      if (this.#closed) {
        void session.stop();
        return;
      }

      this.#streamStartTime = fromMillis(Date.now());
      this.#presence = PlayerPresence.PRESENT;
      lynxRuntimeStore.getState().setRuntime({
        connected: true,
        brokerUrl,
        deploymentName: session.deploymentName,
        session,
        network: session.network.snapshot(),
      });

      this.#rebuildTopics();
      this.#applyWanted();
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

  /** Tell the hub which Channels the panels want, and which fields of each. */
  #applyWanted(): void {
    const session = this.#session;
    if (session == undefined || this.#presence !== PlayerPresence.PRESENT) {
      return;
    }
    const wanted = new Map<string, Array<readonly string[] | undefined>>();
    for (const subscription of this.#requestedSubscriptions) {
      if (!isChannelDataTopic(subscription.topic)) {
        continue;
      }
      const list = wanted.get(subscription.topic) ?? [];
      list.push(subscription.fields);
      wanted.set(subscription.topic, list);
    }
    session.hub.setWanted(wanted as ReadonlyMap<string, LynxWantedFields>);
  }

  /** A Notice from a component, shown as an alert for a while when it is a warning or an error. */
  #showNotice(notice: LynxNoticeEntry): void {
    if (notice.severity < 3) {
      return;
    }
    const id = `lynx:notice:${notice.path}:${notice.action}`;
    const severityName = NOTICE_SEVERITY_NAMES[notice.severity] ?? "notice";
    this.#alerts.addAlert(id, {
      severity: notice.severity >= 4 ? "error" : "warn",
      message: `${notice.path}${notice.action !== "" ? ` (${notice.action})` : ""}: ${notice.message}`,
      tip: `A ${severityName} Notice published by the component.`,
    });
    const timer = setTimeout(() => {
      this.#noticeTimers.delete(timer);
      if (this.#alerts.removeAlert(id)) {
        this.#scheduleEmit();
      }
    }, NOTICE_ALERT_MS);
    this.#noticeTimers.add(timer);
    this.#scheduleEmit();
  }

  #setDatatypesFromPayloadSchema(datatypes: RosDatatypes, schemaName: string, payloadSchema: JsonSchema): void {
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

  /** Rebuild topics and datatypes when the Channel list or schemas change. Returns true if anything changed. */
  #rebuildTopics(): boolean {
    const network = this.#session?.network;
    if (!network) {
      return false;
    }
    const channels = network
      .allChannels()
      .filter((channel) => channel.dataTopic != undefined)
      .sort((a, b) => a.dataTopic!.localeCompare(b.dataTopic!));
    const fingerprint = topicsFingerprint(channels, this.#inferredPayloadSchemas);
    if (fingerprint === this.#topicsFingerprint) {
      return false;
    }
    this.#topicsFingerprint = fingerprint;

    const topics: Topic[] = [];
    const topicSchemaMap = new Map<string, string>();
    const datatypes: RosDatatypes = new Map();

    for (const channel of channels) {
      const topic = channel.dataTopic!;
      const schemaName = lynxChannelSchemaName(channel.servicePath, channel.key);
      topics.push({ name: topic, schemaName });
      topicSchemaMap.set(topic, schemaName);

      const payloadSchema = channel.payloadSchema ?? this.#inferredPayloadSchemas.get(topic);
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

  #evictParsedMessagesIfNeeded(): void {
    if (this.#parsedMessagesBytes <= CURRENT_FRAME_MAXIMUM_SIZE_BYTES) {
      return;
    }
    this.#alerts.addAlert("lynx:parsedMessageCacheFull", {
      severity: "error",
      message: `Lynx player maximum frame size (${(CURRENT_FRAME_MAXIMUM_SIZE_BYTES / 1_000_000).toFixed(
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

  #handleBatch(channel: LynxChannelView, batch: ChannelBatch): void {
    const topic = channel.dataTopic;
    if (topic == undefined) {
      return;
    }
    const nowMs = Date.now();

    for (const sample of batch.samples) {
      this.#maybeInferDatatypesFromSample(topic, sample.data);

      let sizeInBytes = this.#messageSizeEstimateByTopic[topic];
      if (sizeInBytes == undefined) {
        sizeInBytes = estimateObjectSize(sample.data);
        this.#messageSizeEstimateByTopic[topic] = sizeInBytes;
      }

      const messageEvent: MessageEvent = {
        topic,
        receiveTime: clampToNow(toTime(sample.time.s, sample.time.ns), nowMs),
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
      name: `Lynx (${this.#session?.deploymentName ?? "connecting"})`,
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
