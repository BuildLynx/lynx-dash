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
    "Connect to a Lynx sensor network over MQTT WebSocket. Lynx Dash registers as a Lynx service and discovers the network from each component's retained Status and its About. Components that speak an older Lynx protocol are listed as unsupported.";
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
        id: "deploymentName",
        label: "Deployed name (optional)",
        defaultValue: "",
        description:
          "The name this dashboard uses on the Lynx network. Leave empty to get one per browser tab (lynxDash-xxxxxxxx), which lets several dashboards run side by side.",
        validate: (newValue: string): Error | undefined => {
          const value = newValue.trim();
          if (value !== "" && !/^[^/+#\s@?!<]+$/.test(value)) {
            return new Error("A name cannot contain spaces or any of / + # @ ? ! <");
          }
          return undefined;
        },
      },
    ],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const url = args.params?.url;
    // A `serviceId` saved by an older version is ignored: it named every tab the same.
    const deploymentName = args.params?.deploymentName?.trim();
    if (!url) {
      return;
    }

    return new LynxPlayer({
      brokerUrl: url,
      deploymentName: deploymentName === "" ? undefined : deploymentName,
      metricsCollector: args.metricsCollector,
      sourceId: this.id,
    });
  }
}
