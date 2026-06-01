// SPDX-License-Identifier: MPL-2.0

import { Autocomplete, TextField, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import { JsonPayloadEditor } from "@lichtblick/suite-base/components/LynxMessagesSidebar/JsonPayloadEditor";
import { buildTopic } from "@lichtblick/suite-base/components/LynxMessagesSidebar/lynxMessagesUtils";
import {
  lookupEndpointsForBase,
  useLynxComponentIndex,
} from "@lichtblick/suite-base/components/LynxMessagesSidebar/useLynxComponentIndex";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";

import { useStyles } from "./LynxMessagesSidebar.style";

export type ReceiveSectionProps = {
  lastSendAt: number | undefined;
};

export function ReceiveSection(props: ReceiveSectionProps): React.JSX.Element {
  const { lastSendAt } = props;
  const { classes } = useStyles();
  const mqtt = useLynxRuntimeStore((s) => s.mqtt);
  const index = useLynxComponentIndex();

  const [target, setTarget] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [logText, setLogText] = useState("");
  const [displayPayload, setDisplayPayload] = useState<Record<string, unknown>>({});
  const [roundTripMs, setRoundTripMs] = useState<number | undefined>(undefined);

  const baseOptions = useMemo(() => index.bases.map((b) => b.value), [index.bases]);

  const receiveEndpoints = useMemo(
    () => lookupEndpointsForBase(index, target.trim(), "receive"),
    [index, target],
  );

  const targetValid = target.trim() !== "";
  const subscribeTopic =
    targetValid && endpoint.trim() !== "" ? buildTopic(target.trim(), endpoint.trim()) : undefined;

  useEffect(() => {
    if (!targetValid) {
      setEndpoint("");
    } else if (receiveEndpoints.length === 1 && endpoint === "") {
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

      const roundTrip = lastSendAt != undefined ? receivedAt - lastSendAt : undefined;

      setDisplayPayload(payload);
      if (roundTrip != undefined) {
        setRoundTripMs(roundTrip);
      }

      const block = JSON.stringify(raw, undefined, 2) ?? "";
      setLogText((prev) => (prev === "" ? block : `${prev}\n\n---\n\n${block}`));
    });

    return unsubscribe;
  }, [mqtt, subscribeTopic, lastSendAt]);

  return (
    <section className={classes.section}>
      <Typography variant="subtitle2" className={classes.sectionTitle}>
        Receive
      </Typography>

      <Autocomplete
        freeSolo
        size="small"
        options={baseOptions}
        value={target}
        onInputChange={(_e, value) => {
          setTarget(value);
          setEndpoint("");
          setLogText("");
          setRoundTripMs(undefined);
        }}
        onChange={(_e, value) => {
          setTarget(value ?? "");
          setEndpoint("");
          setLogText("");
          setRoundTripMs(undefined);
        }}
        renderInput={(params) => (
          <TextField {...params} label="Component" placeholder="serviceId or serviceId/channelId" />
        )}
      />

      <Autocomplete
        freeSolo
        size="small"
        disabled={!targetValid}
        options={receiveEndpoints.map((e) => e.suffix)}
        value={endpoint}
        onInputChange={(_e, value) => {
          setEndpoint(value);
          setLogText("");
          setRoundTripMs(undefined);
        }}
        onChange={(_e, value) => {
          setEndpoint(value ?? "");
          setLogText("");
          setRoundTripMs(undefined);
        }}
        renderInput={(params) => (
          <TextField {...params} label="Receive endpoint" placeholder="<, @/About, @/Notice, …" />
        )}
      />

      <TextField
        size="small"
        label="Time since send (ms)"
        value={roundTripMs != undefined ? String(roundTripMs) : "—"}
        slotProps={{ input: { readOnly: true } }}
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
            sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap", userSelect: "text" }}
          >
            {logText}
          </Typography>
        ) : (
          <JsonPayloadEditor
            value={displayPayload}
            onChange={() => {}}
            onCustomizedChange={() => {}}
            readOnly
          />
        )}
      </div>
    </section>
  );
}
