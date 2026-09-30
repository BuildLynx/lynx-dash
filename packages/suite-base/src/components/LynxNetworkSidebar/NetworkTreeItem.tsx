// SPDX-License-Identifier: MPL-2.0

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { memo, useCallback, useContext, useMemo, useState } from "react";

import { LynxNetworkContextMenuContext } from "./LynxNetworkContextMenuContext";
import { LynxNetworkSelectionContext } from "./LynxNetworkSelectionContext";
import type { SelectedNetworkItem } from "./LynxNetworkSelectionContext";
import { useStyles } from "./LynxNetworkSidebar.style";
import { channelStatusIcon, formatStateSuffix } from "./networkTreeUtils";

export type NetworkTreeItemKind = "service" | "channel" | "node" | "unsupported";

const MAX_DEPTH = 12;
const ROW_PADDING_STYLES: ReadonlyArray<{ paddingLeft: number }> = Array.from(
  { length: MAX_DEPTH + 1 },
  (_, depth) => ({ paddingLeft: depth * 10 }),
);

export type NetworkTreeItemProps = {
  kind: NetworkTreeItemKind;
  /** The deployed name shown on the row. */
  label: string;
  /** Shown on hover: the title, or why a component is unsupported. */
  tooltip?: string;
  /** Short state shown after the name, such as "connected" or "streaming". */
  stateLabel?: string;
  /** For a Channel: whether data is flowing. */
  streaming?: boolean;
  dimmed?: boolean;
  depth: number;
  selected?: boolean;
  /** Primitives describing what to pass to the selection handler when this row is clicked. */
  selectPath: string;
  selectChannelKey?: string;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
};

function NetworkTreeItemComponent(props: NetworkTreeItemProps): React.JSX.Element {
  const {
    kind,
    label,
    tooltip,
    stateLabel,
    streaming = false,
    dimmed = false,
    depth,
    selected,
    selectPath,
    selectChannelKey,
    children,
    defaultExpanded = true,
  } = props;
  const { classes, cx } = useStyles();
  const onSelectItem = useContext(LynxNetworkSelectionContext);
  const onOpenContextMenu = useContext(LynxNetworkContextMenuContext);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = children != undefined && (!Array.isArray(children) || children.length > 0);
  const isChannel = kind === "channel";
  const isBusy = streaming && !dimmed;

  const colorClasses = cx(dimmed && classes.dimmed, isBusy && classes.busyText);
  const labelClasses = cx(classes.label, colorClasses);

  const rowStyle = ROW_PADDING_STYLES[Math.min(depth, MAX_DEPTH)]!;

  const selectionItem = useMemo((): SelectedNetworkItem => {
    if (kind === "channel" && selectChannelKey != undefined) {
      return { kind: "channel", servicePath: selectPath, channelKey: selectChannelKey };
    }
    if (kind === "unsupported") {
      return { kind: "unsupported", path: selectPath };
    }
    return { kind: "component", path: selectPath };
  }, [kind, selectPath, selectChannelKey]);

  const handleClick = useCallback(() => {
    if (hasChildren) {
      setExpanded((v) => !v);
    }
    onSelectItem(selectionItem);
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
        className={cx(classes.row, selected === true && classes.selected)}
        style={rowStyle}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        title={tooltip}
      >
        {hasChildren ? (
          <span className={classes.expandIcon}>
            {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </span>
        ) : isChannel ? (
          <span className={cx(classes.channelIcon, colorClasses)} aria-hidden>
            {channelStatusIcon(streaming ? "streaming" : "idle")}
          </span>
        ) : (
          <span className={classes.expandIcon} />
        )}
        <span className={labelClasses}>
          {kind === "node" && "[node] "}
          {kind === "unsupported" && "[unsupported] "}
          {label}
          {stateLabel != undefined && <span className={classes.statusText}>{formatStateSuffix(stateLabel)}</span>}
        </span>
      </div>
      {hasChildren && expanded && <div role="group">{children}</div>}
    </div>
  );
}

export const NetworkTreeItem = memo(NetworkTreeItemComponent);
