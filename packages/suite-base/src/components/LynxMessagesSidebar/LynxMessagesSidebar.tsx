// SPDX-License-Identifier: MPL-2.0

import { Autocomplete, TextField, Typography } from "@mui/material";
import type { AutocompleteRenderInputParams } from "@mui/material/Autocomplete";
import { useCallback, useEffect, useMemo, useState } from "react";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { ReceiveSection } from "@lichtblick/suite-base/components/LynxMessagesSidebar/ReceiveSection";
import { SendSection } from "@lichtblick/suite-base/components/LynxMessagesSidebar/SendSection";
import {
  type LynxComponentIndex,
  useLynxComponentIndex,
} from "@lichtblick/suite-base/components/LynxMessagesSidebar/useLynxComponentIndex";
import { SidebarContent } from "@lichtblick/suite-base/components/SidebarContent";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";

import { useStyles } from "./LynxMessagesSidebar.style";

export function LynxMessagesSidebar(): React.JSX.Element {
  const { classes } = useStyles();
  const connected = useLynxRuntimeStore((s) => s.connected);
  const lynxMessagesPrefill = useLynxRuntimeStore((s) => s.lynxMessagesPrefill);
  const clearLynxMessagesPrefill = useLynxRuntimeStore((s) => s.clearLynxMessagesPrefill);
  const index = useLynxComponentIndex();
  const [target, setTarget] = useState("");
  const [lastSendAt, setLastSendAt] = useState<number | undefined>(undefined);
  const [sendEndpointPrefill, setSendEndpointPrefill] = useState<
    { endpoint: string; prefillId: number } | undefined
  >(undefined);
  const [receiveEndpointPrefill, setReceiveEndpointPrefill] = useState<
    { endpoint: string; prefillId: number } | undefined
  >(undefined);

  useEffect(() => {
    if (lynxMessagesPrefill == undefined) {
      return;
    }
    setTarget(lynxMessagesPrefill.target);
    if (
      lynxMessagesPrefill.endpoint != undefined &&
      lynxMessagesPrefill.section === "send"
    ) {
      setSendEndpointPrefill({
        endpoint: lynxMessagesPrefill.endpoint,
        prefillId: lynxMessagesPrefill.id,
      });
      setReceiveEndpointPrefill(undefined);
    } else if (
      lynxMessagesPrefill.endpoint != undefined &&
      lynxMessagesPrefill.section === "receive"
    ) {
      setReceiveEndpointPrefill({
        endpoint: lynxMessagesPrefill.endpoint,
        prefillId: lynxMessagesPrefill.id,
      });
      setSendEndpointPrefill(undefined);
    } else {
      setSendEndpointPrefill(undefined);
      setReceiveEndpointPrefill(undefined);
    }
    clearLynxMessagesPrefill();
  }, [lynxMessagesPrefill, clearLynxMessagesPrefill]);

  const baseOptions = useMemo(
    () => index.bases.map((b) => b.value).sort((a, b) => a.localeCompare(b)),
    [index.bases],
  );

  const handleTargetInputChange = useCallback((_e: React.SyntheticEvent, value: string) => {
    setTarget(value);
  }, []);

  const handleTargetChange = useCallback((_e: React.SyntheticEvent, value: string | null) => {
    setTarget(value ?? "");
  }, []);

  const renderTargetInput = useCallback(
    (params: AutocompleteRenderInputParams) => (
      <TextField {...params} label="Component" placeholder="name or name/channel" />
    ),
    [],
  );

  return (
    <SidebarContent title="Lynx Messages" disablePadding disableToolbar>
      {!connected ? (
        <EmptyState>Connect to a Lynx network to send and receive messages.</EmptyState>
      ) : (
        <div className={classes.root}>
          <section className={classes.section}>
            <Typography variant="subtitle2" className={classes.sectionTitle}>
              Component
            </Typography>
            <Autocomplete
              freeSolo
              size="small"
              options={baseOptions}
              value={target}
              onInputChange={handleTargetInputChange}
              onChange={handleTargetChange}
              renderInput={renderTargetInput}
            />
          </section>
          <SendSection
            index={index}
            target={target}
            onSend={setLastSendAt}
            endpointPrefill={sendEndpointPrefill}
          />
          <ReceiveSection
            index={index}
            target={target}
            lastSendAt={lastSendAt}
            endpointPrefill={receiveEndpointPrefill}
          />
        </div>
      )}
    </SidebarContent>
  );
}

export type { LynxComponentIndex };
