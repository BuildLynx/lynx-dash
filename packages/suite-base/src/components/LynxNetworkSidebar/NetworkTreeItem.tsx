// SPDX-License-Identifier: MPL-2.0

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { memo, useCallback, useContext, useMemo, useState } from "react";

import type { LynxComponentState } from "@lichtblick/suite-base/lynx/types";

import { useStyles } from "./LynxNetworkSidebar.style";
import { LynxNetworkContextMenuContext } from "./LynxNetworkContextMenuContext";
import { LynxNetworkSelectionContext } from "./LynxNetworkSelectionContext";
import type { SelectedNetworkItem } from "./LynxNetworkSelectionContext";
import {
  channelStatusIcon,
  formatStateSuffix,
} from "./networkTreeUtils";

export type NetworkTreeItemKind = "service" | "channel" | "node";

const MAX_DEPTH = 12;
const ROW_PADDING_STYLES: ReadonlyArray<{ paddingLeft: number }> = Array.from(
  { length: MAX_DEPTH + 1 },
  (_, depth) => ({ paddingLeft: depth * 10 }),
);

export type NetworkTreeItemProps = {
  kind: NetworkTreeItemKind;
  id: string;
  state?: LynxComponentState;
  dimmed?: boolean;
  depth: number;
  selected?: boolean;
  /** Primitives describing what to pass to the selection handler when this row is clicked. */
  selectKind?: "service" | "channel" | "node";
  selectServiceId?: string;
  selectChannelId?: string;
  selectNodeId?: string;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
};

function NetworkTreeItemComponent(props: NetworkTreeItemProps): React.JSX.Element {
  const {
    kind,
    id,
    state,
    dimmed = false,
    depth,
    selected,
    selectKind,
    selectServiceId,
    selectChannelId,
    selectNodeId,
    children,
    defaultExpanded = true,
  } = props;
  const { classes, cx } = useStyles();
  const onSelectItem = useContext(LynxNetworkSelectionContext);
  const onOpenContextMenu = useContext(LynxNetworkContextMenuContext);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = children != undefined;
  const isChannel = kind === "channel";
  const isBusy = state === "busy" && !dimmed;

  const colorClasses = cx(
    dimmed && classes.dimmed,
    isBusy && classes.busyText,
  );
  const labelClasses = cx(classes.label, colorClasses);

  const rowStyle = ROW_PADDING_STYLES[Math.min(depth, MAX_DEPTH)]!;

  const selectionItem = useMemo((): SelectedNetworkItem => {
    if (selectKind === "service" && selectServiceId != undefined) {
      return { kind: "service", serviceId: selectServiceId };
    }
    if (
      selectKind === "channel" &&
      selectServiceId != undefined &&
      selectChannelId != undefined
    ) {
      return { kind: "channel", serviceId: selectServiceId, channelId: selectChannelId };
    }
    if (selectKind === "node" && selectNodeId != undefined) {
      return { kind: "node", nodeId: selectNodeId };
    }
    return undefined;
  }, [selectKind, selectServiceId, selectChannelId, selectNodeId]);

  const handleClick = useCallback(() => {
    if (hasChildren) {
      setExpanded((v) => !v);
    }
    if (selectionItem != undefined) {
      onSelectItem(selectionItem);
    }
  }, [hasChildren, selectionItem, onSelectItem]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenContextMenu({
        item: selectionItem,
        mouseX: event.clientX,
        mouseY: event.clientY,
      });
    },
    [onOpenContextMenu, selectionItem],
  );

  return (
    <div>
      <div
        className={cx(classes.row, selected && classes.selected)}
        style={rowStyle}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
      >
        {hasChildren ? (
          <span className={classes.expandIcon}>
            {expanded ? (
              <ExpandMoreIcon fontSize="small" />
            ) : (
              <ChevronRightIcon fontSize="small" />
            )}
          </span>
        ) : isChannel ? (
          <span className={cx(classes.channelIcon, colorClasses)} aria-hidden>
            {channelStatusIcon(state)}
          </span>
        ) : (
          <span className={classes.expandIcon} />
        )}
        <span className={labelClasses}>
          {kind === "node" && "[node] "}
          {id}
          {kind !== "node" && (
            <span className={classes.statusText}>{formatStateSuffix(state)}</span>
          )}
        </span>
      </div>
      {hasChildren && expanded && <div role="group">{children}</div>}
    </div>
  );
}

export const NetworkTreeItem = memo(NetworkTreeItemComponent);
