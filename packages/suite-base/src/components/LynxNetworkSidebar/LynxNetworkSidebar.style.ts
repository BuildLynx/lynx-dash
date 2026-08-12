// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  tree: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: theme.spacing(1),
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body2.fontSize,
  },
  row: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.borderRadius,
    minHeight: 28,
    "&:hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
  selected: {
    backgroundColor: theme.palette.action.selected,
  },
  expandIcon: {
    width: 18,
    height: 18,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  channelIcon: {
    width: 18,
    flexShrink: 0,
    textAlign: "center",
    fontSize: "0.6rem",
    lineHeight: 1,
  },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  statusText: {
    color: theme.palette.text.secondary,
  },
  dimmed: {
    color: theme.palette.text.disabled,
    "& $statusText": {
      color: theme.palette.text.disabled,
    },
  },
  busyText: {
    color: theme.palette.success.main,
    "& $statusText": {
      color: theme.palette.success.main,
    },
  },
  detailSection: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    overflow: "hidden",
    minHeight: 0,
  },
  resizeHandle: {
    flexShrink: 0,
    height: 8,
    cursor: "ns-resize",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderTop: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
    "&:hover": {
      backgroundColor: theme.palette.action.hover,
    },
    "&:hover .MuiSvgIcon-root": {
      opacity: 1,
    },
  },
  resizeIcon: {
    fontSize: "1rem",
    opacity: 0.3,
    transition: theme.transitions.create("opacity", {
      duration: theme.transitions.duration.short,
    }),
    transform: "rotate(90deg)",
    color: theme.palette.text.secondary,
  },
  detail: {
    flex: 1,
    minHeight: 0,
    padding: theme.spacing(1),
    overflow: "auto",
    fontSize: theme.typography.caption.fontSize,
  },
  endpointList: {
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
  },
  endpointRow: {
    display: "block",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.caption.fontSize,
    padding: theme.spacing(0.25, 0.5, 0.25, 1.5),
    borderRadius: theme.shape.borderRadius,
    cursor: "context-menu",
    wordBreak: "break-all",
    "&:hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
}));
