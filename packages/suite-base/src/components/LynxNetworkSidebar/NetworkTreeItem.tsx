// SPDX-License-Identifier: MPL-2.0

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useState } from "react";

import type { LynxComponentState } from "@lichtblick/suite-base/lynx/types";

import { useStyles } from "./LynxNetworkSidebar.style";
import {
  channelStatusIcon,
  formatStateSuffix,
} from "./networkTreeUtils";

export type NetworkTreeItemKind = "service" | "channel" | "node";

export type NetworkTreeItemProps = {
  kind: NetworkTreeItemKind;
  id: string;
  state?: LynxComponentState;
  dimmed?: boolean;
  depth: number;
  selected?: boolean;
  onSelect?: () => void;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
};

export function NetworkTreeItem(props: NetworkTreeItemProps): React.JSX.Element {
  const {
    kind,
    id,
    state,
    dimmed = false,
    depth,
    selected,
    onSelect,
    children,
    defaultExpanded = true,
  } = props;
  const { classes, cx } = useStyles();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = children != undefined;
  const isChannel = kind === "channel";
  const isBusy = state === "busy" && !dimmed;

  const colorClasses = cx(
    dimmed && classes.dimmed,
    isBusy && classes.busyText,
  );
  const labelClasses = cx(classes.label, colorClasses);

  return (
    <div>
      <div
        className={cx(classes.row, selected && classes.selected)}
        style={{ paddingLeft: depth * 10 }}
        onClick={() => {
          if (hasChildren) {
            setExpanded((v) => !v);
          }
          onSelect?.();
        }}
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
