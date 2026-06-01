// SPDX-License-Identifier: MPL-2.0

import { Typography } from "@mui/material";
import { memo, useMemo } from "react";

import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import { channelOutputTopic } from "@lichtblick/suite-base/lynx/types";

import type { SelectedNetworkItem } from "./LynxNetworkSelectionContext";
import { useStyles } from "./LynxNetworkSidebar.style";

const SCHEMA_PRE_SX = {
  mt: 1,
  whiteSpace: "pre-wrap",
  fontFamily: "monospace",
} as const;

export type DetailPanelProps = {
  selected: SelectedNetworkItem;
};

function DetailPanelComponent({ selected }: DetailPanelProps): React.JSX.Element {
  const { classes } = useStyles();
  const networkState = useLynxRuntimeStore((s) => s.networkState);

  const channelAbout = useMemo(() => {
    if (selected?.kind !== "channel") {
      return undefined;
    }
    return networkState?.getChannelAbout(selected.serviceId, selected.channelId);
  }, [networkState, selected]);

  const serviceAbout = useMemo(() => {
    if (selected?.kind !== "service") {
      return undefined;
    }
    return networkState?.getServiceAbout(selected.serviceId);
  }, [networkState, selected]);

  const nodeAbout = useMemo(() => {
    if (selected?.kind !== "node") {
      return undefined;
    }
    return networkState?.getNodeAbout(selected.nodeId);
  }, [networkState, selected]);

  if (selected == undefined) {
    return (
      <div className={classes.detail}>
        <Typography variant="caption" color="text.secondary">
          Select an item to view details.
        </Typography>
      </div>
    );
  }

  if (selected.kind === "channel") {
    const channel = channelAbout;
    const outputSchema =
      channel?.endpoints?.[`${selected.serviceId}/${selected.channelId}/<`]?.payload_schema ??
      channel?.endpoints?.["<"]?.payload_schema;
    const outputSchemaText =
      outputSchema != undefined ? JSON.stringify(outputSchema, undefined, 2) : undefined;

    if (!channel) {
      return (
        <div className={classes.detail}>
          <Typography variant="caption" color="text.secondary">
            No channel metadata available.
          </Typography>
        </div>
      );
    }

    return (
      <div className={classes.detail}>
        <Typography variant="subtitle2">{channel.docs?.title ?? selected.channelId}</Typography>
        {channel.docs?.description != undefined && channel.docs.description !== "" && (
          <Typography variant="caption" color="text.secondary" display="block">
            {channel.docs.description}
          </Typography>
        )}
        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
          State: {channel.status?.state ?? "unknown"}
        </Typography>
        <Typography variant="caption" display="block">
          Topic: {channelOutputTopic(selected.serviceId, selected.channelId)}
        </Typography>
        {outputSchemaText != undefined && (
          <Typography variant="caption" component="pre" sx={SCHEMA_PRE_SX}>
            {outputSchemaText}
          </Typography>
        )}
      </div>
    );
  }

  if (selected.kind === "service") {
    const service = serviceAbout;
    if (!service) {
      return (
        <div className={classes.detail}>
          <Typography variant="caption" color="text.secondary">
            No service metadata available.
          </Typography>
        </div>
      );
    }
    const channelCount = Object.keys(service.channels ?? {}).length;
    return (
      <div className={classes.detail}>
        <Typography variant="subtitle2">{service.docs?.title ?? selected.serviceId}</Typography>
        {service.docs?.description != undefined && service.docs.description !== "" && (
          <Typography variant="caption" color="text.secondary" display="block">
            {service.docs.description}
          </Typography>
        )}
        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
          State: {service.status?.state ?? "unknown"}
        </Typography>
        <Typography variant="caption" display="block">
          Channels: {channelCount}
        </Typography>
        {service.docs?.lynx_version != undefined && (
          <Typography variant="caption" display="block">
            Lynx version: {service.docs.lynx_version}
          </Typography>
        )}
      </div>
    );
  }

  if (selected.kind === "node") {
    const node = nodeAbout;
    if (!node) {
      return (
        <div className={classes.detail}>
          <Typography variant="caption" color="text.secondary">
            No node metadata available.
          </Typography>
        </div>
      );
    }
    const serviceCount = Object.keys(node.services ?? {}).length;
    const childNodeCount = Object.keys(node.child_nodes ?? {}).length;
    return (
      <div className={classes.detail}>
        <Typography variant="subtitle2">{node.docs?.title ?? selected.nodeId}</Typography>
        {node.docs?.description != undefined && node.docs.description !== "" && (
          <Typography variant="caption" color="text.secondary" display="block">
            {node.docs.description}
          </Typography>
        )}
        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
          State: {node.status?.state ?? "unknown"}
        </Typography>
        <Typography variant="caption" display="block">
          Services: {serviceCount}
        </Typography>
        {childNodeCount > 0 && (
          <Typography variant="caption" display="block">
            Child nodes: {childNodeCount}
          </Typography>
        )}
      </div>
    );
  }

  return (
    <div className={classes.detail}>
      <Typography variant="caption" color="text.secondary">
        Select an item to view details.
      </Typography>
    </div>
  );
}

export const DetailPanel = memo(DetailPanelComponent);
