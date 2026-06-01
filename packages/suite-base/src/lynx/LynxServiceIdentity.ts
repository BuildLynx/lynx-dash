// SPDX-License-Identifier: MPL-2.0

import type { InboundMessage } from "lynx-sdk-typescript";

import type { LynxMqttManager } from "@lichtblick/suite-base/lynx/LynxMqttManager";
import { LYNX_PROTOCOL_VERSION, type LynxServiceAbout } from "@lichtblick/suite-base/lynx/types";

export type LynxServiceIdentityOptions = {
  serviceId: string;
  title?: string;
  description?: string;
};

export class LynxServiceIdentity {
  readonly #mqtt: LynxMqttManager;
  readonly #serviceId: string;
  readonly #title: string;
  readonly #description: string;

  public constructor(mqtt: LynxMqttManager, options: LynxServiceIdentityOptions) {
    this.#mqtt = mqtt;
    this.#serviceId = options.serviceId;
    this.#title = options.title ?? "Lynx Dash";
    this.#description =
      options.description ?? "Lichtblick-based dashboard for Lynx sensor networks.";
  }

  public get serviceId(): string {
    return this.#serviceId;
  }

  public register(): void {
    const queryTopic = `${this.#serviceId}/?/About`;
    this.#mqtt.addMessageHandler(queryTopic, (msg) => {
      this.#handleAboutQuery(msg);
    });
    this.publishAbout();
  }

  public publishAbout(): void {
    const about = this.buildAboutPayload();
    this.#mqtt.publish(`${this.#serviceId}/@/About`, about as unknown as Record<string, unknown>, 1, true);
  }

  public buildAboutPayload(): LynxServiceAbout {
    return {
      lynxType: "Service",
      docs: {
        id: this.#serviceId,
        title: this.#title,
        description: this.#description,
        lynx_version: LYNX_PROTOCOL_VERSION,
        time_source: "unix",
      },
      config: {},
      status: {
        state: "idle",
        action: { command: "", payload: {} },
      },
      endpoints: {
        [`${this.#serviceId}/@/About`]: {
          endpoint_direction: "pub",
          description: "Service self-description",
        },
        [`${this.#serviceId}/?/About`]: {
          endpoint_direction: "sub",
          description: "Query service About",
        },
        [`${this.#serviceId}/@/Notice`]: {
          endpoint_direction: "pub",
          description: "Structured notices",
        },
      },
      channels: {},
    };
  }

  #handleAboutQuery(msg: InboundMessage): void {
    let about = this.buildAboutPayload();
    const contents = msg.payload.contents;
    if (contents === false) {
      return;
    }
    if (contents === true || contents == undefined) {
      this.#mqtt.publish(`${this.#serviceId}/@/About`, about as unknown as Record<string, unknown>, 1, true);
      return;
    }
    if (typeof contents === "object" && contents != null) {
      const trimmed: Record<string, unknown> = {};
      for (const [key, include] of Object.entries(contents)) {
        if (include === true && key in about) {
          trimmed[key] = (about as unknown as Record<string, unknown>)[key];
        }
      }
      if (Object.keys(trimmed).length > 0) {
        about = { ...about, ...trimmed } as unknown as LynxServiceAbout;
      }
      this.#mqtt.publish(`${this.#serviceId}/@/About`, about as unknown as Record<string, unknown>, 1, true);
    }
  }
}
