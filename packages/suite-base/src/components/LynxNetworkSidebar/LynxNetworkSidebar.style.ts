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
  detail: {
    borderTop: `1px solid ${theme.palette.divider}`,
    padding: theme.spacing(1),
    maxHeight: "40%",
    overflow: "auto",
    fontSize: theme.typography.caption.fontSize,
  },
}));
