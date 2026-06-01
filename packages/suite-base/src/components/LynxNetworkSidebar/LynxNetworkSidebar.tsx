// SPDX-License-Identifier: MPL-2.0

import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { Menu, MenuItem, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import type {
  LynxNetworkStateRoot,
  LynxServiceAbout,
} from "@lichtblick/suite-base/lynx/types";

import { DetailPanel } from "./ChannelDetailPanel";
import {
  LynxNetworkContextMenuContext,
  type LynxNetworkContextMenuRequest,
} from "./LynxNetworkContextMenuContext";
import {
  LynxNetworkSelectionContext,
  type SelectedNetworkItem,
} from "./LynxNetworkSelectionContext";
import { useStyles } from "./LynxNetworkSidebar.style";
import { NetworkTreeItem } from "./NetworkTreeItem";
import { getStatusState, isDimmedState } from "./networkTreeUtils";
import { useLynxNetworkActions } from "./useLynxNetworkActions";

export type { SelectedNetworkItem };

const DETAIL_DEFAULT_HEIGHT = 200;
const DETAIL_MIN_HEIGHT = 80;
const DETAIL_MAX_HEIGHT_RATIO = 0.6;

function sortEntries<T>(entries: [string, T][]): [string, T][] {
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

function renderServices(
  services: Record<string, LynxServiceAbout>,
  depth: number,
  parentDimmed: boolean,
  selected: SelectedNetworkItem,
): React.ReactNode[] {
  return sortEntries(Object.entries(services)).flatMap(([serviceId, service]) => {
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
        selectKind="service"
        selectServiceId={serviceId}
      >
        {sortEntries(Object.entries(channels)).map(([channelId, channel]) => {
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
              selectKind="channel"
              selectServiceId={serviceId}
              selectChannelId={channelId}
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
): React.ReactNode[] {
  return sortEntries(Object.entries(nodes)).map(([nodeId, nodeState]) => (
    <NetworkTreeItem
      key={`node-${nodeId}`}
      kind="node"
      id={nodeId}
      dimmed={parentDimmed}
      depth={depth}
      selected={selected?.kind === "node" && selected.nodeId === nodeId}
      selectKind="node"
      selectNodeId={nodeId}
    >
      {renderServices(nodeState.services, depth + 1, parentDimmed, selected)}
      {renderNodes(nodeState.childNodes, depth + 1, parentDimmed, selected)}
    </NetworkTreeItem>
  ));
}

type ContextMenuState = {
  mouseX: number;
  mouseY: number;
  item: SelectedNetworkItem;
};

export function LynxNetworkSidebar(): React.JSX.Element {
  const { classes } = useStyles();
  const connected = useLynxRuntimeStore((s) => s.connected);
  const networkStateRoot = useLynxRuntimeStore((s) => s.networkStateRoot);
  const [selected, setSelected] = useState<SelectedNetworkItem>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | undefined>(undefined);
  const [detailHeight, setDetailHeight] = useState(DETAIL_DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const { refresh, about, streamToggle, poll, isChannelBusy } = useLynxNetworkActions();

  const maxDetailHeight = useCallback(() => {
    const containerHeight = rootRef.current?.clientHeight ?? 600;
    return Math.max(DETAIL_MIN_HEIGHT, Math.floor(containerHeight * DETAIL_MAX_HEIGHT_RATIO));
  }, []);

  const handleSelectItem = useCallback((item: SelectedNetworkItem) => {
    setSelected(item);
  }, []);

  const handleOpenContextMenu = useCallback((request: LynxNetworkContextMenuRequest) => {
    if (request.item != undefined) {
      setSelected(request.item);
    }
    setContextMenu({
      mouseX: request.mouseX,
      mouseY: request.mouseY,
      item: request.item,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(undefined);
  }, []);

  const handleResizeMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setIsDragging(true);
      startYRef.current = event.clientY;
      startHeightRef.current = detailHeight;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [detailHeight],
  );

  const handleResizeMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!isDragging) {
        return;
      }
      const deltaY = startYRef.current - event.clientY;
      const newHeight = Math.max(
        DETAIL_MIN_HEIGHT,
        Math.min(maxDetailHeight(), startHeightRef.current + deltaY),
      );
      setDetailHeight(newHeight);
    },
    [isDragging, maxDetailHeight],
  );

  const handleResizeMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }
    document.addEventListener("mousemove", handleResizeMouseMove);
    document.addEventListener("mouseup", handleResizeMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleResizeMouseMove);
      document.removeEventListener("mouseup", handleResizeMouseUp);
    };
  }, [isDragging, handleResizeMouseMove, handleResizeMouseUp]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      switch (event.key) {
        case "r":
          event.preventDefault();
          refresh();
          break;
        case "a":
          event.preventDefault();
          about(selected);
          break;
        case "s":
          event.preventDefault();
          streamToggle(selected);
          break;
        case "p":
          event.preventDefault();
          poll(selected);
          break;
      }
    },
    [refresh, about, streamToggle, poll, selected],
  );

  const tree = useMemo(() => {
    if (!connected) {
      return undefined;
    }
    const items: React.ReactNode[] = [];
    items.push(...renderServices(networkStateRoot.services, 0, false, selected));
    items.push(...renderNodes(networkStateRoot.childNodes, 0, false, selected));
    return items;
  }, [connected, networkStateRoot, selected]);

  const contextItem = contextMenu?.item;
  const contextAboutEnabled = contextItem != undefined;
  const contextChannel = contextItem?.kind === "channel";
  const contextBusy = contextChannel && isChannelBusy(contextItem);

  return (
    <div ref={rootRef} className={classes.root}>
      {!connected ? (
        <EmptyState>Connect to a Lynx network to inspect services and channels.</EmptyState>
      ) : (
        <LynxNetworkSelectionContext.Provider value={handleSelectItem}>
          <LynxNetworkContextMenuContext.Provider value={handleOpenContextMenu}>
            <div
              ref={treeRef}
              className={classes.tree}
              role="tree"
              tabIndex={0}
              onKeyDown={handleKeyDown}
              onClick={() => {
                treeRef.current?.focus();
              }}
            >
              {tree != undefined && tree.length > 0 ? (
                tree
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                  Waiting for About messages on the broker…
                </Typography>
              )}
            </div>
            <div
              className={classes.resizeHandle}
              onMouseDown={handleResizeMouseDown}
              title="Drag to resize details"
            >
              <DragIndicatorIcon className={classes.resizeIcon} />
            </div>
            <div
              className={classes.detailSection}
              style={{ height: detailHeight }}
            >
              <DetailPanel selected={selected} />
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
                  refresh();
                  handleCloseContextMenu();
                }}
              >
                Refresh
              </MenuItem>
              <MenuItem
                disabled={!contextAboutEnabled}
                onClick={() => {
                  about(contextItem);
                  handleCloseContextMenu();
                }}
              >
                About
              </MenuItem>
              <MenuItem
                disabled={!contextChannel}
                onClick={() => {
                  streamToggle(contextItem);
                  handleCloseContextMenu();
                }}
              >
                {contextBusy ? "Stop" : "Stream"}
              </MenuItem>
              <MenuItem
                disabled={!contextChannel}
                onClick={() => {
                  poll(contextItem);
                  handleCloseContextMenu();
                }}
              >
                Poll
              </MenuItem>
            </Menu>
          </LynxNetworkContextMenuContext.Provider>
        </LynxNetworkSelectionContext.Provider>
      )}
    </div>
  );
}
