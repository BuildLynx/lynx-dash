// SPDX-License-Identifier: MPL-2.0

import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import type { AutocompleteRenderInputParams } from "@mui/material/Autocomplete";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { JsonPayloadEditor } from "@lichtblick/suite-base/components/LynxMessagesSidebar/JsonPayloadEditor";
import { SchemaForm } from "@lichtblick/suite-base/components/LynxMessagesSidebar/SchemaForm";
import {
  buildTopic,
  defaultPayloadFromSchema,
  type LynxEndpointRef,
} from "@lichtblick/suite-base/components/LynxMessagesSidebar/lynxMessagesUtils";
import {
  type LynxComponentIndex,
  lookupEndpointsForBase,
} from "@lichtblick/suite-base/components/LynxMessagesSidebar/useLynxComponentIndex";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import type { JsonSchema } from "@lichtblick/suite-base/lynx/types";

import { useStyles } from "./LynxMessagesSidebar.style";

export type EndpointPrefill = {
  endpoint: string;
  prefillId: number;
};

export type SendSectionProps = {
  index: LynxComponentIndex;
  target: string;
  onSend: (sentAt: number) => void;
  endpointPrefill?: EndpointPrefill;
};

export function SendSection(props: SendSectionProps): React.JSX.Element {
  const { index, target, onSend, endpointPrefill } = props;
  const { classes } = useStyles();
  const session = useLynxRuntimeStore((s) => s.session);

  const [endpoint, setEndpoint] = useState("");
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [jsonCustomized, setJsonCustomized] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingFormDataRef = useRef<Record<string, unknown> | undefined>(undefined);

  const [prevTarget, setPrevTarget] = useState(target);
  if (prevTarget !== target) {
    setPrevTarget(target);
    setEndpoint("");
    setJsonCustomized(false);
  }

  const sendEndpoints = useMemo(
    () => lookupEndpointsForBase(index, target.trim(), "send"),
    [index, target],
  );

  const endpointOptions = useMemo(
    () => sendEndpoints.map((e) => e.suffix).sort((a, b) => a.localeCompare(b)),
    [sendEndpoints],
  );

  const selectedEndpoint: LynxEndpointRef | undefined = useMemo(() => {
    const trimmed = endpoint.trim();
    return sendEndpoints.find((e) => e.suffix === trimmed);
  }, [sendEndpoints, endpoint]);

  const payloadSchema: JsonSchema | undefined = selectedEndpoint?.payload_schema ?? undefined;
  const hasSchema =
    payloadSchema != undefined &&
    typeof payloadSchema === "object" &&
    Object.keys(payloadSchema).length > 0;

  const targetValid = target.trim() !== "";

  useEffect(() => {
    if (endpointPrefill == undefined) {
      return;
    }
    setEndpoint(endpointPrefill.endpoint);
    setJsonCustomized(false);
  }, [endpointPrefill?.prefillId, endpointPrefill]);

  useEffect(() => {
    if (!targetValid) {
      return;
    }
    if (endpointPrefill != undefined) {
      return;
    }
    if (sendEndpoints.length === 1 && endpoint === "") {
      setEndpoint(sendEndpoints[0]!.suffix);
    }
  }, [targetValid, sendEndpoints, endpoint, endpointPrefill]);

  useEffect(() => {
    if (selectedEndpoint != undefined && !jsonCustomized) {
      setFormData(defaultPayloadFromSchema(selectedEndpoint.payload_schema));
    }
  }, [selectedEndpoint, jsonCustomized]);

  const applyFormData = useCallback((data: Record<string, unknown>) => {
    setFormData(data);
    setJsonCustomized(false);
  }, []);

  const handleFormChange = useCallback(
    (data: Record<string, unknown>) => {
      if (jsonCustomized) {
        pendingFormDataRef.current = data;
        setConfirmOpen(true);
        return;
      }
      applyFormData(data);
    },
    [jsonCustomized, applyFormData],
  );

  const handleConfirmOverwrite = useCallback(() => {
    if (pendingFormDataRef.current != undefined) {
      applyFormData(pendingFormDataRef.current);
    }
    pendingFormDataRef.current = undefined;
    setConfirmOpen(false);
  }, [applyFormData]);

  const handleCancelOverwrite = useCallback(() => {
    pendingFormDataRef.current = undefined;
    setConfirmOpen(false);
  }, []);

  const handleSend = useCallback(() => {
    if (session == undefined || !targetValid || endpoint.trim() === "") {
      return;
    }
    const topic = buildTopic(target.trim(), endpoint.trim());
    session.publish(topic, formData, { qos: 1 });
    onSend(Date.now());
  }, [session, targetValid, endpoint, target, formData, onSend]);

  const handleEndpointInputChange = useCallback((_e: React.SyntheticEvent, value: string) => {
    setEndpoint(value);
    setJsonCustomized(false);
  }, []);

  const handleEndpointChange = useCallback((_e: React.SyntheticEvent, value: string | null) => {
    setEndpoint(value ?? "");
    setJsonCustomized(false);
  }, []);

  const renderEndpointInput = useCallback(
    (params: AutocompleteRenderInputParams) => (
      <TextField {...params} label="Query / command" placeholder="?/About, !/Poll, …" />
    ),
    [],
  );

  return (
    <section className={classes.section}>
      <Typography variant="subtitle2" className={classes.sectionTitle}>
        Send
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

      {hasSchema && selectedEndpoint != undefined && (
        <>
          <Typography variant="caption" color="text.secondary">
            Payload forming
          </Typography>
          <div className={classes.schemaForm}>
            <SchemaForm schema={payloadSchema} formData={formData} onChange={handleFormChange} />
          </div>
        </>
      )}

      <Typography variant="caption" color="text.secondary">
        JSON payload
      </Typography>
      <div className={classes.jsonEditor}>
        <JsonPayloadEditor
          value={formData}
          onChange={setFormData}
          onCustomizedChange={setJsonCustomized}
        />
      </div>

      <Button
        variant="contained"
        size="small"
        disabled={session == undefined || !targetValid || endpoint.trim() === ""}
        onClick={handleSend}
        className={classes.sendButton}
      >
        Send
      </Button>

      <Dialog open={confirmOpen} onClose={handleCancelOverwrite}>
        <DialogTitle>Overwrite custom JSON?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You edited the JSON payload manually. Changing a field in the form will replace your custom
            payload. Continue?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelOverwrite}>Cancel</Button>
          <Button onClick={handleConfirmOverwrite} variant="contained" autoFocus>
            Overwrite
          </Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}
