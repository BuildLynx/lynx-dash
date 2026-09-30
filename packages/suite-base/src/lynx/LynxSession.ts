// SPDX-License-Identifier: MPL-2.0

import {
  LynxObserver,
  Service,
  UnixTimeSource,
  type InboundMessage,
  type Logger,
  type StorageLike,
} from "lynx-sdk-typescript";

import { LynxChannelHub } from "@lichtblick/suite-base/lynx/LynxChannelHub";
import { LynxNetwork } from "@lichtblick/suite-base/lynx/LynxNetwork";
import { LynxStreamSettingsStore } from "@lichtblick/suite-base/lynx/LynxStreamSettings";
import {
  LYNX_DASH_COMPONENT_NAME,
  claimDashDeployment,
  type LockManagerLike,
} from "@lichtblick/suite-base/lynx/lynxIdentity";

export type LynxConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface LynxSessionOptions {
  /** The broker's WebSocket URL (`ws://` or `wss://`). */
  brokerUrl: string;
  /** A deployed name for this dash, if the user chose one. Otherwise one is generated per tab. */
  deploymentName?: string;
  /** How many levels of Nodes to watch. Default 1: the components on the broker itself. */
  observerDepth?: number;
  /** Per-tab identity storage. Defaults to `sessionStorage`. */
  identityStorage?: StorageLike;
  /** Persistent storage for stream settings. Defaults to `localStorage`. */
  settingsStorage?: StorageLike;
  locks?: LockManagerLike;
  logger?: Logger;
}

const quietLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: (message, ...args) => {
    console.warn("[lynx]", message, ...args);
  },
  error: (message, ...args) => {
    console.error("[lynx]", message, ...args);
  },
};

function browserStorage(kind: "sessionStorage" | "localStorage"): StorageLike | undefined {
  try {
    const storage = (globalThis as unknown as Record<string, StorageLike | undefined>)[kind];
    if (storage == undefined) {
      return undefined;
    }
    const probe = "lynx:probe";
    storage.setItem(probe, "1");
    storage.getItem(probe);
    return storage;
  } catch {
    return undefined;
  }
}

/**
 * One dash's connection to a Lynx network.
 *
 * Two MQTT connections carry it. The **service** connection is the dash's own presence: a real
 * SDK {@link Service} with a retained Status and a Last Will, so other components see the dash
 * come and go. The **observer** connection is anonymous: it watches every other component,
 * carries Stream and Poll commands and their data, and serves the Messages sidebar.
 */
export class LynxSession {
  public readonly brokerUrl: string;
  public readonly deploymentName: string;
  public readonly service: Service;
  public readonly lynx: LynxObserver;
  public readonly network: LynxNetwork;
  public readonly hub: LynxChannelHub;
  public readonly settings: LynxStreamSettingsStore;

  readonly #receiveObservers = new Map<string, Set<(msg: InboundMessage) => void>>();
  readonly #subscriptionCounts = new Map<string, number>();
  readonly #logger: Logger;
  #state: LynxConnectionState = "disconnected";
  #error: Error | undefined;
  #unsubscribeMessages: (() => void) | undefined;
  #stopped = false;
  #onPageHide: (() => void) | undefined;

  private constructor(options: LynxSessionOptions, deploymentName: string, service: Service) {
    this.brokerUrl = options.brokerUrl;
    this.deploymentName = deploymentName;
    this.service = service;
    this.#logger = options.logger ?? quietLogger;

    this.lynx = new LynxObserver({
      brokerSocket: [options.brokerUrl, 0],
      depth: options.observerDepth ?? 1,
      timeSource: new UnixTimeSource(),
      // The dash does not list itself.
      include: (path) => path !== deploymentName,
      logger: this.#logger,
    });
    this.network = new LynxNetwork(this.lynx.observer);
    this.settings = new LynxStreamSettingsStore(options.settingsStorage ?? browserStorage("localStorage"));
    this.hub = new LynxChannelHub({
      network: this.network,
      settings: this.settings,
      transport: {
        publish: (topic, payload) => {
          this.publish(topic, payload, { qos: 1 });
        },
        subscribe: (topic) => {
          this.subscribeTopic(topic);
        },
        unsubscribe: (topic) => {
          this.unsubscribeTopic(topic);
        },
      },
    });
  }

  /**
   * Decide this tab's identity and build the session. Nothing is connected until {@link start}.
   */
  public static async create(options: LynxSessionOptions): Promise<LynxSession> {
    const claimed = await claimDashDeployment({
      requestedName: options.deploymentName,
      storage: options.identityStorage ?? browserStorage("sessionStorage"),
      locks: options.locks,
    });
    const service = new Service({
      name: LYNX_DASH_COMPONENT_NAME,
      title: "Lynx Dash",
      description: "Lichtblick-based dashboard for Lynx sensor networks.",
      brokerSocket: [options.brokerUrl, 0],
      deployment: { name: claimed.name },
      deploymentStore: claimed.deploymentStore,
      timeSource: new UnixTimeSource(),
      logger: options.logger ?? quietLogger,
      // Warnings and errors only; the dash has little to say.
      noticeLevel: 3,
    });
    return new LynxSession(options, claimed.name, service);
  }

  public getConnectionState(): LynxConnectionState {
    return this.#state;
  }

  public getConnectionError(): Error | undefined {
    return this.#error;
  }

  /**
   * Connect the observer (rejecting if the broker cannot be reached), then announce the dash
   * itself in the background. The dash is usable before its own presence is confirmed.
   */
  public async start(): Promise<void> {
    this.#state = "connecting";
    this.#error = undefined;
    try {
      await this.lynx.start();
    } catch (err: unknown) {
      this.#state = "error";
      this.#error = err instanceof Error ? err : new Error(String(err));
      throw this.#error;
    }
    this.#state = "connected";

    const client = this.lynx.mqttClient;
    // Anything wanted before the connection existed.
    for (const topic of this.#subscriptionCounts.keys()) {
      client.subscribe(topic, 0);
    }
    this.#unsubscribeMessages = client.addMessageObserver((msg) => {
      this.hub.handleMessage(msg.topic, msg.payload, { sec: msg.sec, nsec: msg.nsec });
      for (const [filter, listeners] of this.#receiveObservers) {
        if (topicMatches(filter, msg.topic)) {
          for (const listener of [...listeners]) {
            listener(msg);
          }
        }
      }
    });
    // After a reconnect, announcements may have been missed and Streams may have changed.
    client.client.on("connect", () => {
      this.#state = "connected";
      this.network.reconcileAll();
      this.hub.refresh();
    });
    client.client.on("close", () => {
      if (!this.#stopped) {
        this.#state = "disconnected";
      }
    });

    this.service.start().catch((err: unknown) => {
      this.#logger.error(`Could not announce the dash on the network: ${String(err)}`);
    });

    if (typeof window !== "undefined") {
      // Best effort: a closing tab has little time, but a clean removal spares the broker a ghost.
      this.#onPageHide = () => {
        void this.stop();
      };
      window.addEventListener("pagehide", this.#onPageHide);
    }
  }

  /** Stop streams this dash started, leave the network, and disconnect. */
  public async stop(): Promise<void> {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    if (this.#onPageHide != undefined && typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.#onPageHide);
    }
    this.hub.setWanted(new Map());
    this.hub.dispose();
    this.#unsubscribeMessages?.();
    this.#receiveObservers.clear();
    this.#state = "disconnected";
    this.network.dispose();
    await Promise.allSettled([
      // `remove`: this identity belongs to one tab, so its retained presence is cleared, not left as "down".
      this.service.stop({ remove: true }),
      this.lynx.stop(),
    ]);
  }

  public publish(
    topic: string,
    payload: Record<string, unknown> | unknown[],
    options: { qos?: 0 | 1 | 2; retain?: boolean } = {},
  ): void {
    this.lynx.mqttClient.publish(topic, payload, options.qos ?? 0, options.retain ?? false);
  }

  /**
   * Listen to inbound messages on `topicFilter` without replacing anyone else's handlers.
   * Subscribes on the broker as needed. Returns an unsubscribe function.
   */
  public addReceiveObserver(topicFilter: string, listener: (msg: InboundMessage) => void): () => void {
    let listeners = this.#receiveObservers.get(topicFilter);
    if (listeners == undefined) {
      listeners = new Set();
      this.#receiveObservers.set(topicFilter, listeners);
    }
    listeners.add(listener);
    this.subscribeTopic(topicFilter);

    return () => {
      const set = this.#receiveObservers.get(topicFilter);
      const removed = set?.delete(listener) ?? false;
      if (!removed || set == undefined) {
        return;
      }
      if (set.size === 0) {
        this.#receiveObservers.delete(topicFilter);
      }
      this.unsubscribeTopic(topicFilter);
    };
  }

  /** Subscribe on the broker; the same filter can be wanted by several users and is dropped with the last. */
  public subscribeTopic(topic: string): void {
    const count = this.#subscriptionCounts.get(topic) ?? 0;
    this.#subscriptionCounts.set(topic, count + 1);
    if (count === 0 && this.#state === "connected") {
      this.lynx.mqttClient.subscribe(topic, 0);
    }
  }

  public unsubscribeTopic(topic: string): void {
    const count = this.#subscriptionCounts.get(topic) ?? 0;
    if (count <= 1) {
      this.#subscriptionCounts.delete(topic);
      if (count === 1 && this.#state === "connected") {
        this.lynx.mqttClient.client.unsubscribe(topic);
      }
    } else {
      this.#subscriptionCounts.set(topic, count - 1);
    }
  }
}

/** MQTT topic filter matching (`+` one level, `#` the rest). */
export function topicMatches(filter: string, topic: string): boolean {
  const filterParts = filter.split("/");
  const topicParts = topic.split("/");
  for (let i = 0; i < filterParts.length; i++) {
    if (filterParts[i] === "#") {
      return true;
    }
    if (filterParts[i] === "+") {
      if (i >= topicParts.length) {
        return false;
      }
      continue;
    }
    if (i >= topicParts.length || filterParts[i] !== topicParts[i]) {
      return false;
    }
  }
  return filterParts.length === topicParts.length;
}
