// SPDX-License-Identifier: MPL-2.0

import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { Menu, MenuItem, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import type { LynxNetworkSnapshot } from "@lichtblick/suite-base/lynx/types";

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
import { channelStateLabel, componentStateLabel, isDimmedComponent } from "./networkTreeUtils";
import { useLynxNetworkActions } from "./useLynxNetworkActions";
import { useViewInLynxMessages } from "./useViewInLynxMessages";

export type { SelectedNetworkItem };

const DETAIL_DEFAULT_HEIGHT = 200;
const DETAIL_MIN_HEIGHT = 80;
const DETAIL_MAX_HEIGHT_RATIO = 0.6;

/** One component, its Channels, and the components observed beneath it. */
function renderComponent(
  snapshot: LynxNetworkSnapshot,
  path: string,
  depth: number,
  parent: { dimmed: boolean },
  selected: SelectedNetworkItem,
): React.ReactNode {
  const component = snapshot.components[path];
  if (component == undefined) {
    return undefined;
  }
  const dimmed = parent.dimmed || isDimmedComponent(component);
  const channels = Object.values(component.channels).sort((a, b) => a.name.localeCompare(b.name));
  const childPaths = snapshot.childrenOf[path] ?? [];

  return (
    <NetworkTreeItem
      key={`component-${path}`}
      kind={component.kind}
      label={component.name}
      tooltip={component.title !== component.name ? component.title : undefined}
      stateLabel={component.kind === "node" ? undefined : componentStateLabel(component)}
      dimmed={dimmed}
      depth={depth}
      selected={selected?.kind === "component" && selected.path === path}
      selectPath={path}
    >
      {[
        ...channels.map((channel) => (
          <NetworkTreeItem
            key={`channel-${path}-${channel.key}`}
            kind="channel"
            label={channel.name}
            tooltip={channel.title !== channel.name ? channel.title : undefined}
            stateLabel={channelStateLabel(channel.command)}
            streaming={channel.command?.command === "Stream"}
            dimmed={dimmed}
            depth={depth + 1}
            defaultExpanded={false}
            selected={selected?.kind === "channel" && selected.servicePath === path && selected.channelKey === channel.key}
            selectPath={path}
            selectChannelKey={channel.key}
          />
        )),
        ...childPaths.map((childPath) => renderComponent(snapshot, childPath, depth + 1, { dimmed }, selected)),
      ]}
    </NetworkTreeItem>
  );
}

type ContextMenuState = {
  mouseX: number;
  mouseY: number;
  item: SelectedNetworkItem;
};

export function LynxNetworkSidebar(): React.JSX.Element {
  const { classes } = useStyles();
  const connected = useLynxRuntimeStore((s) => s.connected);
  const snapshot = useLynxRuntimeStore((s) => s.network);
  const [selected, setSelected] = useState<SelectedNetworkItem>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | undefined>(undefined);
  const [detailHeight, setDetailHeight] = useState(DETAIL_DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const { refresh, about, streamToggle, poll, isChannelStreaming } = useLynxNetworkActions();
  const { viewComponent } = useViewInLynxMessages();

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
    const items: React.ReactNode[] = snapshot.roots.map((path) => renderComponent(snapshot, path, 0, { dimmed: false }, selected));
    for (const entry of snapshot.unsupported) {
      items.push(
        <NetworkTreeItem
          key={`unsupported-${entry.path}`}
          kind="unsupported"
          label={entry.path}
          tooltip={entry.reason}
          dimmed
          depth={0}
          selected={selected?.kind === "unsupported" && selected.path === entry.path}
          selectPath={entry.path}
        />,
      );
    }
    return items;
  }, [connected, snapshot, selected]);

  const contextItem = contextMenu?.item;
  const contextAboutEnabled = contextItem != undefined;
  const contextChannel = contextItem?.kind === "channel";
  const contextBusy = contextChannel && isChannelStreaming(contextItem);

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
                  Waiting for components to announce themselves on the broker…
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
                  viewComponent(contextItem);
                  handleCloseContextMenu();
                }}
              >
                View in Lynx Messages Tab
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
                {contextBusy ? "Stop stream" : "Start stream"}
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
