// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "auto",
    padding: theme.spacing(1),
    gap: theme.spacing(2),
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(1),
    paddingBottom: theme.spacing(1),
    borderBottom: `1px solid ${theme.palette.divider}`,
    "&:last-child": {
      borderBottom: "none",
    },
  },
  sectionTitle: {
    fontWeight: 600,
  },
  schemaForm: {
    maxHeight: 240,
    overflow: "auto",
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(0.5),
  },
  jsonEditor: {
    minHeight: 120,
    maxHeight: 200,
    overflow: "auto",
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
  },
  receiveLog: {
    margin: 0,
    padding: theme.spacing(1),
    maxHeight: 200,
    overflow: "auto",
  },
  sendButton: {
    alignSelf: "flex-start",
  },
}));
