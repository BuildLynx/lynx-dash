// SPDX-License-Identifier: MPL-2.0

import { Menu, MenuItem, Typography } from "@mui/material";
import { memo, useCallback, useMemo, useState } from "react";

import {
  collectEndpointRefsForBase,
  classifyEndpointSection,
} from "@lichtblick/suite-base/lynx/lynxMessagesNavigation";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import type { LynxAction, LynxEndpointAbout } from "@lichtblick/suite-base/lynx/types";

import type { SelectedNetworkItem } from "./LynxNetworkSelectionContext";
import { useStyles } from "./LynxNetworkSidebar.style";
import { useViewInLynxMessages } from "./useViewInLynxMessages";

export type DetailPanelProps = {
  selected: SelectedNetworkItem;
};

function formatAction(action: LynxAction | undefined): string {
  if (action == undefined || action.command === "") {
    return "(none)";
  }
  return action.command;
}

function formatKeyList(keys: string[]): string {
  return keys.length > 0 ? keys.join(", ") : "(none)";
}

function DetailField({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <Typography variant="caption" display="block">
      {label}: {value}
    </Typography>
  );
}

type EndpointContextMenuState = {
  mouseX: number;
  mouseY: number;
  target: string;
  endpoint: string;
  section: "send" | "receive";
};

type EndpointListProps = {
  base: string;
  endpoints: Record<string, LynxEndpointAbout> | undefined;
};

function EndpointList({ base, endpoints }: EndpointListProps): React.JSX.Element {
  const { classes } = useStyles();
  const { viewEndpoint } = useViewInLynxMessages();
  const [contextMenu, setContextMenu] = useState<EndpointContextMenuState | undefined>(undefined);

  const refs = useMemo(() => collectEndpointRefsForBase(base, endpoints), [base, endpoints]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(undefined);
  }, []);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, suffix: string) => {
      event.preventDefault();
      const ref = refs.find((r) => r.suffix === suffix);
      if (ref == undefined) {
        return;
      }
      const section = classifyEndpointSection(ref);
      if (section == undefined) {
        return;
      }
      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
        target: base,
        endpoint: suffix,
        section,
      });
    },
    [base, refs],
  );

  if (refs.length === 0) {
    return <DetailField label="Endpoints" value="(none)" />;
  }

  return (
    <>
      <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
        Endpoints:
      </Typography>
      <div className={classes.endpointList}>
        {refs.map((ref) => (
          <Typography
            key={ref.suffix}
            variant="caption"
            component="div"
            className={classes.endpointRow}
            onContextMenu={(event) => {
              handleContextMenu(event, ref.suffix);
            }}
          >
            {ref.suffix === "" ? base : ref.fullTopic}
          </Typography>
        ))}
      </div>
      <Menu
        open={contextMenu != undefined}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu != undefined
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem
          onClick={() => {
            if (contextMenu != undefined) {
              viewEndpoint({
                target: contextMenu.target,
                endpoint: contextMenu.endpoint,
                section: contextMenu.section,
              });
            }
            handleCloseContextMenu();
          }}
        >
          View in Lynx Messages Tab
        </MenuItem>
      </Menu>
    </>
  );
}

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

    if (!channel) {
      return (
        <div className={classes.detail}>
          <Typography variant="caption" color="text.secondary">
            No channel metadata available.
          </Typography>
        </div>
      );
    }

    const base = `${selected.serviceId}/${selected.channelId}`;

    return (
      <div className={classes.detail}>
        <Typography variant="subtitle2">{channel.docs?.title ?? selected.channelId}</Typography>
        <DetailField label="ID" value={channel.docs?.id ?? selected.channelId} />
        <DetailField label="Type" value="channel" />
        <DetailField label="Service" value={selected.serviceId} />
        {channel.docs?.description != undefined && channel.docs.description !== "" && (
          <Typography variant="caption" color="text.secondary" display="block">
            {channel.docs.description}
          </Typography>
        )}
        {channel.docs?.lynx_version != undefined && channel.docs.lynx_version !== "" && (
          <DetailField label="Lynx version" value={channel.docs.lynx_version} />
        )}
        <DetailField label="State" value={channel.status?.state ?? "unknown"} />
        <DetailField label="Action" value={formatAction(channel.status?.action)} />
        <EndpointList base={base} endpoints={channel.endpoints} />
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

    const channelKeys = Object.keys(service.channels ?? {}).sort((a, b) => a.localeCompare(b));

    return (
      <div className={classes.detail}>
        <Typography variant="subtitle2">{service.docs?.title ?? selected.serviceId}</Typography>
        <DetailField label="ID" value={service.docs?.id ?? selected.serviceId} />
        <DetailField label="Type" value="service" />
        {service.docs?.description != undefined && service.docs.description !== "" && (
          <Typography variant="caption" color="text.secondary" display="block">
            {service.docs.description}
          </Typography>
        )}
        {service.docs?.lynx_version != undefined && service.docs.lynx_version !== "" && (
          <DetailField label="Lynx version" value={service.docs.lynx_version} />
        )}
        <DetailField label="State" value={service.status?.state ?? "unknown"} />
        <DetailField label="Action" value={formatAction(service.status?.action)} />
        <DetailField label="Channels" value={formatKeyList(channelKeys)} />
        <EndpointList base={selected.serviceId} endpoints={service.endpoints} />
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

    const serviceKeys = Object.keys(node.services ?? {}).sort((a, b) => a.localeCompare(b));
    const childNodeKeys = Object.keys(node.child_nodes ?? {}).sort((a, b) => a.localeCompare(b));

    return (
      <div className={classes.detail}>
        <Typography variant="subtitle2">{node.docs?.title ?? selected.nodeId}</Typography>
        <DetailField label="ID" value={node.docs?.id ?? selected.nodeId} />
        <DetailField label="Type" value="node" />
        {node.docs?.description != undefined && node.docs.description !== "" && (
          <Typography variant="caption" color="text.secondary" display="block">
            {node.docs.description}
          </Typography>
        )}
        <DetailField label="State" value={node.status?.state ?? "unknown"} />
        <DetailField label="Services" value={formatKeyList(serviceKeys)} />
        <DetailField label="Child nodes" value={formatKeyList(childNodeKeys)} />
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
