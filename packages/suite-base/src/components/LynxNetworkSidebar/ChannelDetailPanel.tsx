// SPDX-License-Identifier: MPL-2.0

import { Typography } from "@mui/material";

import type { LynxChannelAbout } from "@lichtblick/suite-base/lynx/types";

import { useStyles } from "./LynxNetworkSidebar.style";

export type ChannelDetailPanelProps = {
  serviceId: string;
  channelId: string;
  channel: LynxChannelAbout | undefined;
};

export function ChannelDetailPanel(props: ChannelDetailPanelProps): React.JSX.Element {
  const { serviceId, channelId, channel } = props;
  const { classes } = useStyles();

  if (!channel) {
    return (
      <div className={classes.detail}>
        <Typography variant="caption" color="text.secondary">
          No channel metadata available.
        </Typography>
      </div>
    );
  }

  const outputSchema =
    channel.endpoints?.[`${serviceId}/${channelId}/<`]?.payload_schema ??
    channel.endpoints?.["<"]?.payload_schema;

  return (
    <div className={classes.detail}>
      <Typography variant="subtitle2">{channel.docs?.title ?? channelId}</Typography>
      {channel.docs?.description != undefined && channel.docs.description !== "" && (
        <Typography variant="caption" color="text.secondary" display="block">
          {channel.docs.description}
        </Typography>
      )}
      <Typography variant="caption" display="block" sx={{ mt: 1 }}>
        State: {channel.status?.state ?? "unknown"}
      </Typography>
      <Typography variant="caption" display="block">
        Topic: {serviceId}/{channelId}
      </Typography>
      {outputSchema != undefined && (
        <Typography
          variant="caption"
          component="pre"
          sx={{ mt: 1, whiteSpace: "pre-wrap", fontFamily: "monospace" }}
        >
          {JSON.stringify(outputSchema, undefined, 2)}
        </Typography>
      )}
    </div>
  );
}
