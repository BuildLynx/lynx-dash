// SPDX-License-Identifier: MPL-2.0

import { Autocomplete, TextField, Typography } from "@mui/material";
import type { AutocompleteRenderInputParams } from "@mui/material/Autocomplete";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { JsonPayloadEditor } from "@lichtblick/suite-base/components/LynxMessagesSidebar/JsonPayloadEditor";
import { buildTopic } from "@lichtblick/suite-base/components/LynxMessagesSidebar/lynxMessagesUtils";
import {
  type LynxComponentIndex,
  lookupEndpointsForBase,
} from "@lichtblick/suite-base/components/LynxMessagesSidebar/useLynxComponentIndex";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";

import { useStyles } from "./LynxMessagesSidebar.style";

const READ_ONLY_INPUT_SLOT_PROPS = { input: { readOnly: true } } as const;
const RECEIVE_LOG_SX = {
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
  userSelect: "text",
} as const;
const NO_OP = (): void => {};

export type ReceiveSectionProps = {
  index: LynxComponentIndex;
  target: string;
  lastSendAt: number | undefined;
};

export function ReceiveSection(props: ReceiveSectionProps): React.JSX.Element {
  const { index, target, lastSendAt } = props;
  const lastSendAtRef = useRef(lastSendAt);
  lastSendAtRef.current = lastSendAt;

  const { classes } = useStyles();
  const mqtt = useLynxRuntimeStore((s) => s.mqtt);

  const [endpoint, setEndpoint] = useState("");
  const [logText, setLogText] = useState("");
  const [displayPayload, setDisplayPayload] = useState<Record<string, unknown>>({});
  const [roundTripMs, setRoundTripMs] = useState<number | undefined>(undefined);

  const [prevTarget, setPrevTarget] = useState(target);
  if (prevTarget !== target) {
    setPrevTarget(target);
    setEndpoint("");
    setLogText("");
    setRoundTripMs(undefined);
  }

  const receiveEndpoints = useMemo(
    () => lookupEndpointsForBase(index, target.trim(), "receive"),
    [index, target],
  );

  const endpointOptions = useMemo(
    () => receiveEndpoints.map((e) => e.suffix).sort((a, b) => a.localeCompare(b)),
    [receiveEndpoints],
  );

  const targetValid = target.trim() !== "";
  const subscribeTopic =
    targetValid && endpoint.trim() !== "" ? buildTopic(target.trim(), endpoint.trim()) : undefined;

  useEffect(() => {
    if (!targetValid) {
      return;
    }
    if (receiveEndpoints.length === 1 && endpoint === "") {
      setEndpoint(receiveEndpoints[0]!.suffix);
    }
  }, [targetValid, receiveEndpoints, endpoint]);

  useEffect(() => {
    if (mqtt == undefined || subscribeTopic == undefined) {
      return;
    }

    const unsubscribe = mqtt.addReceiveObserver(subscribeTopic, (msg) => {
      const receivedAt = Date.now();
      const raw = msg.payload;
      const payload: Record<string, unknown> =
        typeof raw === "object" && raw != null && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : { value: raw };

      const sendAt = lastSendAtRef.current;
      const roundTrip = sendAt != undefined ? receivedAt - sendAt : undefined;

      setDisplayPayload(payload);
      if (roundTrip != undefined) {
        setRoundTripMs(roundTrip);
      }

      const block = JSON.stringify(raw, undefined, 2) ?? "";
      setLogText((prev) => (prev === "" ? block : `${prev}\n\n---\n\n${block}`));
    });

    return unsubscribe;
  }, [mqtt, subscribeTopic]);

  const handleEndpointInputChange = useCallback((_e: React.SyntheticEvent, value: string) => {
    setEndpoint(value);
    setLogText("");
    setRoundTripMs(undefined);
  }, []);

  const handleEndpointChange = useCallback((_e: React.SyntheticEvent, value: string | null) => {
    setEndpoint(value ?? "");
    setLogText("");
    setRoundTripMs(undefined);
  }, []);

  const renderEndpointInput = useCallback(
    (params: AutocompleteRenderInputParams) => (
      <TextField {...params} label="Receive endpoint" placeholder="<, @/About, @/Notice, …" />
    ),
    [],
  );

  return (
    <section className={classes.section}>
      <Typography variant="subtitle2" className={classes.sectionTitle}>
        Receive
      </Typography>

      <Autocomplete
        freeSolo
        size="small"
        disabled={!targetValid}
        options={endpointOptions}
        value={endpoint}
        onInputChange={handleEndpointInputChange}
        onChange={handleEndpointChange}
        renderInput={renderEndpointInput}
      />

      <TextField
        size="small"
        label="Time since send (ms)"
        value={roundTripMs != undefined ? String(roundTripMs) : "—"}
        slotProps={READ_ONLY_INPUT_SLOT_PROPS}
        fullWidth
      />

      <Typography variant="caption" color="text.secondary">
        Raw payload
      </Typography>
      <div className={classes.jsonEditor}>
        {logText !== "" ? (
          <Typography
            component="pre"
            variant="caption"
            className={classes.receiveLog}
            sx={RECEIVE_LOG_SX}
          >
            {logText}
          </Typography>
        ) : (
          <JsonPayloadEditor
            value={displayPayload}
            onChange={NO_OP}
            onCustomizedChange={NO_OP}
            readOnly
          />
        )}
      </div>
    </section>
  );
}
