// SPDX-License-Identifier: MPL-2.0

import {
  LynxMqttClient,
  UnixTimeSource,
  type InboundMessage,
  type MessageHandler,
} from "lynx-sdk-typescript";

function mqttTopicMatch(pattern: string, topic: string): boolean {
  const patParts = pattern.split("/");
  const topParts = topic.split("/");

  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i] === "#") {
      return true;
    }
    if (patParts[i] === "+") {
      continue;
    }
    if (i >= topParts.length || patParts[i] !== topParts[i]) {
      return false;
    }
  }
  return patParts.length === topParts.length;
}

import {
  channelOutputTopic,
  channelStopTopic,
  channelStreamTopic,
  LYNX_CHANNEL_ABOUT_MONITOR_TOPIC,
  type LynxChannelOutput,
  type LynxPollRequest,
  type LynxStreamRequest,
} from "@lichtblick/suite-base/lynx/types";

export type LynxMqttConnectionState = "disconnected" | "connecting" | "connected" | "error";

export class LynxMqttManager {
  readonly #clientId: string;
  readonly #mqtt: LynxMqttClient;
  #connectionState: LynxMqttConnectionState = "disconnected";
  #connectionError: Error | undefined;
  #brokerUrl: string | undefined;
  #receiveObservers = new Map<string, Set<(msg: InboundMessage) => void>>();
  #messageObserverUnsub: (() => void) | undefined;

  public constructor(clientId: string) {
    this.#clientId = clientId;
    this.#mqtt = new LynxMqttClient(clientId, new UnixTimeSource());
  }

  public get clientId(): string {
    return this.#clientId;
  }

  public get mqttClient(): LynxMqttClient {
    return this.#mqtt;
  }

  public get connectionState(): LynxMqttConnectionState {
    return this.#connectionState;
  }

  public get connectionError(): Error | undefined {
    return this.#connectionError;
  }

  public get brokerUrl(): string | undefined {
    return this.#brokerUrl;
  }

  public async connect(brokerUrl: string, serviceId: string): Promise<void> {
    this.#connectionState = "connecting";
    this.#connectionError = undefined;
    this.#brokerUrl = brokerUrl;

    const willTopic = `${serviceId}/@/About`;
    const disconnectedPayload = JSON.stringify({ status: { state: "disconnected" } }) ?? "";
    await this.#mqtt.connect(brokerUrl, {
      will: {
        topic: willTopic,
        payload: Buffer.from(disconnectedPayload),
        qos: 1,
        retain: true,
      },
    });

    this.#connectionState = "connected";
    this.#mqtt.subscribe(`${serviceId}/#`, 0);
    this.#mqtt.subscribe("+/@/About", 0);
    this.#mqtt.subscribe(LYNX_CHANNEL_ABOUT_MONITOR_TOPIC, 0);
  }

  public disconnect(): void {
    this.#messageObserverUnsub?.();
    this.#messageObserverUnsub = undefined;
    this.#receiveObservers.clear();
    this.#mqtt.disconnect();
    this.#connectionState = "disconnected";
    this.#brokerUrl = undefined;
  }

  /**
   * Subscribe to inbound messages on `topicFilter` without replacing LynxPlayer handlers.
   * Returns an unsubscribe function.
   */
  public addReceiveObserver(
    topicFilter: string,
    listener: (msg: InboundMessage) => void,
  ): () => void {
    if (this.#messageObserverUnsub == undefined) {
      this.#messageObserverUnsub = this.#mqtt.addMessageObserver((msg) => {
        for (const [filter, listeners] of this.#receiveObservers) {
          if (mqttTopicMatch(filter, msg.topic)) {
            for (const fn of listeners) {
              fn(msg);
            }
          }
        }
      });
    }

    if (this.#connectionState === "connected") {
      this.#mqtt.subscribe(topicFilter, 0);
    }

    let listeners = this.#receiveObservers.get(topicFilter);
    if (listeners == undefined) {
      listeners = new Set();
      this.#receiveObservers.set(topicFilter, listeners);
    }
    listeners.add(listener);

    return () => {
      const set = this.#receiveObservers.get(topicFilter);
      if (set == undefined) {
        return;
      }
      set.delete(listener);
      if (set.size === 0) {
        this.#receiveObservers.delete(topicFilter);
      }
    };
  }

  public addMessageHandler(topic: string, handler: MessageHandler): void {
    this.#mqtt.addCallback(topic, handler);
    if (this.#connectionState === "connected") {
      this.#mqtt.subscribe(topic, 0);
    }
  }

  public removeMessageHandler(topic: string): void {
    this.#mqtt.removeCallback(topic);
  }

  public publish(
    topic: string,
    payload: Record<string, unknown> | unknown[],
    qos: 0 | 1 | 2 = 0,
    retain = false,
  ): void {
    this.#mqtt.publish(topic, payload, qos, retain, {}, true);
  }

  public startStream(
    serviceId: string,
    channelId: string,
    request: LynxStreamRequest = {},
    onOutput?: (msg: InboundMessage) => void,
  ): void {
    const outputTopic = channelOutputTopic(serviceId, channelId);
    if (onOutput) {
      this.addMessageHandler(outputTopic, onOutput);
    }
    const streamPayload: LynxStreamRequest = {
      contents: true,
      interval: 0.25,
      numSamples: 0,
      paginate: 1,
      ...request,
    };
    this.publish(
      channelStreamTopic(serviceId, channelId),
      streamPayload as Record<string, unknown>,
      0,
      false,
    );
  }

  public stopStream(serviceId: string, channelId: string): void {
    this.publish(channelStopTopic(serviceId, channelId), {}, 0, false);
    this.removeMessageHandler(channelOutputTopic(serviceId, channelId));
  }

  public poll(
    serviceId: string,
    channelId: string,
    request: LynxPollRequest = {},
    onOutput?: (msg: InboundMessage) => void,
  ): void {
    const outputTopic = channelOutputTopic(serviceId, channelId);
    if (onOutput) {
      this.addMessageHandler(outputTopic, onOutput);
    }
    this.publish(`${serviceId}/${channelId}/!/Poll`, { contents: true, ...request }, 0, false);
  }

  public static parseChannelOutput(payload: Record<string, unknown>): LynxChannelOutput {
    if (Array.isArray(payload)) {
      return payload as LynxChannelOutput;
    }
    return [];
  }
}
