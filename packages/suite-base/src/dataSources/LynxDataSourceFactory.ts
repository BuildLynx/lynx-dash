// SPDX-License-Identifier: MPL-2.0

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { DEFAULT_LYNX_BROKER_URL } from "@lichtblick/suite-base/lynx/lynxConf";
import LynxPlayer from "@lichtblick/suite-base/players/LynxPlayer/LynxPlayer";
import { Player } from "@lichtblick/suite-base/players/types";

export default class LynxDataSourceFactory implements IDataSourceFactory {
  public id = "lynx";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "Lynx Network";
  public iconName: IDataSourceFactory["iconName"] = "Flow";
  public description =
    "Connect to a Lynx sensor network over MQTT WebSocket. Lynx Dash registers as a first-class Lynx service and discovers network topology from retained About messages.";
  public docsLinks = [
    {
      label: "Lynx Protocol",
      url: "https://github.com/",
    },
  ];

  public formConfig = {
    fields: [
      {
        id: "url",
        label: "MQTT WebSocket URL",
        defaultValue: DEFAULT_LYNX_BROKER_URL,
        description:
          "Broker WebSocket URL (ws:// or wss://). Leave as default or use lynxConf.json at deploy root for UpstreamNodeHost/Port.",
        validate: (newValue: string): Error | undefined => {
          try {
            const url = new URL(newValue);
            if (url.protocol !== "ws:" && url.protocol !== "wss:") {
              return new Error(`Invalid protocol: ${url.protocol}`);
            }
            return undefined;
          } catch (err: unknown) {
            console.error(err);
            return new Error("Enter a valid WebSocket URL");
          }
        },
      },
      {
        id: "serviceId",
        label: "Lynx Service ID",
        defaultValue: "lynxDash",
        description: "Service ID for this dashboard instance on the Lynx network.",
      },
    ],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const url = args.params?.url;
    const serviceId = args.params?.serviceId ?? "lynxDash";
    if (!url) {
      return;
    }

    return new LynxPlayer({
      brokerUrl: url,
      serviceId,
      metricsCollector: args.metricsCollector,
      sourceId: this.id,
    });
  }
}
