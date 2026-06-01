// SPDX-License-Identifier: MPL-2.0

import { Typography } from "@mui/material";
import { useMemo, useState } from "react";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { SidebarContent } from "@lichtblick/suite-base/components/SidebarContent";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import type {
  LynxChannelAbout,
  LynxNetworkStateRoot,
  LynxServiceAbout,
} from "@lichtblick/suite-base/lynx/types";

import { ChannelDetailPanel } from "./ChannelDetailPanel";
import { useStyles } from "./LynxNetworkSidebar.style";
import { NetworkTreeItem } from "./NetworkTreeItem";
import {
  getStatusState,
  isDimmedState,
} from "./networkTreeUtils";

export type SelectedNetworkItem =
  | { kind: "channel"; serviceId: string; channelId: string }
  | { kind: "service"; serviceId: string }
  | undefined;

function renderServices(
  services: Record<string, LynxServiceAbout>,
  depth: number,
  parentDimmed: boolean,
  selected: SelectedNetworkItem,
  onSelect: (item: SelectedNetworkItem) => void,
): React.ReactNode[] {
  return Object.entries(services).flatMap(([serviceId, service]) => {
    if (service == undefined) {
      return [];
    }
    const serviceState = getStatusState(service);
    const serviceDimmed = parentDimmed || isDimmedState(serviceState);
    const channels = service.channels ?? {};
    return (
      <NetworkTreeItem
        key={`service-${serviceId}`}
        kind="service"
        id={serviceId}
        state={serviceState}
        dimmed={serviceDimmed}
        depth={depth}
        selected={selected?.kind === "service" && selected.serviceId === serviceId}
        onSelect={() => {
          onSelect({ kind: "service", serviceId });
        }}
      >
        {Object.entries(channels).map(([channelId, channel]) => {
          const channelState = getStatusState(channel);
          const channelDimmed = serviceDimmed || isDimmedState(channelState);
          return (
            <NetworkTreeItem
              key={`channel-${serviceId}-${channelId}`}
              kind="channel"
              id={channelId}
              state={channelState}
              dimmed={channelDimmed}
              depth={depth + 1}
              defaultExpanded={false}
              selected={
                selected?.kind === "channel" &&
                selected.serviceId === serviceId &&
                selected.channelId === channelId
              }
              onSelect={() => {
                onSelect({ kind: "channel", serviceId, channelId });
              }}
            />
          );
        })}
      </NetworkTreeItem>
    );
  });
}

function renderNodes(
  nodes: Record<string, LynxNetworkStateRoot>,
  depth: number,
  parentDimmed: boolean,
  selected: SelectedNetworkItem,
  onSelect: (item: SelectedNetworkItem) => void,
): React.ReactNode[] {
  return Object.entries(nodes).map(([nodeId, nodeState]) => (
    <NetworkTreeItem
      key={`node-${nodeId}`}
      kind="node"
      id={nodeId}
      dimmed={parentDimmed}
      depth={depth}
      onSelect={() => {
        onSelect(undefined);
      }}
    >
      {renderServices(nodeState.services, depth + 1, parentDimmed, selected, onSelect)}
      {renderNodes(nodeState.childNodes, depth + 1, parentDimmed, selected, onSelect)}
    </NetworkTreeItem>
  ));
}

export function LynxNetworkSidebar(): React.JSX.Element {
  const { classes } = useStyles();
  const connected = useLynxRuntimeStore((s) => s.connected);
  const networkStateRoot = useLynxRuntimeStore((s) => s.networkStateRoot);
  const networkState = useLynxRuntimeStore((s) => s.networkState);
  const [selected, setSelected] = useState<SelectedNetworkItem>(undefined);

  const selectedChannel: LynxChannelAbout | undefined = useMemo(() => {
    if (selected?.kind !== "channel") {
      return undefined;
    }
    return networkState?.getChannelAbout(selected.serviceId, selected.channelId);
  }, [networkState, selected]);

  const tree = useMemo(() => {
    if (!connected) {
      return undefined;
    }
    const items: React.ReactNode[] = [];
    items.push(...renderServices(networkStateRoot.services, 0, false, selected, setSelected));
    items.push(...renderNodes(networkStateRoot.childNodes, 0, false, selected, setSelected));
    return items;
  }, [connected, networkStateRoot, selected]);

  return (
    <SidebarContent title="Lynx Network" disablePadding>
      <div className={classes.root}>
        {!connected ? (
          <EmptyState>Connect to a Lynx network to inspect services and channels.</EmptyState>
        ) : (
          <>
            <div className={classes.tree} role="tree">
              {tree != undefined && tree.length > 0 ? (
                tree
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                  Waiting for About messages on the broker…
                </Typography>
              )}
            </div>
            {selected?.kind === "channel" && (
              <ChannelDetailPanel
                serviceId={selected.serviceId}
                channelId={selected.channelId}
                channel={selectedChannel}
              />
            )}
          </>
        )}
      </div>
    </SidebarContent>
  );
}
