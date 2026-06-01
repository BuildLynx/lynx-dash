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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { JsonPayloadEditor } from "@lichtblick/suite-base/components/LynxMessagesSidebar/JsonPayloadEditor";
import {
  buildTopic,
  defaultPayloadFromSchema,
  type LynxEndpointRef,
} from "@lichtblick/suite-base/components/LynxMessagesSidebar/lynxMessagesUtils";
import { SchemaForm } from "@lichtblick/suite-base/components/LynxMessagesSidebar/SchemaForm";
import {
  lookupEndpointsForBase,
  useLynxComponentIndex,
} from "@lichtblick/suite-base/components/LynxMessagesSidebar/useLynxComponentIndex";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import type { JsonSchema } from "@lichtblick/suite-base/lynx/types";

import { useStyles } from "./LynxMessagesSidebar.style";

export type SendSectionProps = {
  onSend: (sentAt: number) => void;
};

export function SendSection(props: SendSectionProps): React.JSX.Element {
  const { onSend } = props;
  const { classes } = useStyles();
  const mqtt = useLynxRuntimeStore((s) => s.mqtt);
  const index = useLynxComponentIndex();

  const [target, setTarget] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [jsonCustomized, setJsonCustomized] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingFormDataRef = useRef<Record<string, unknown> | undefined>(undefined);

  const baseOptions = useMemo(() => index.bases.map((b) => b.value), [index.bases]);

  const sendEndpoints = useMemo(
    () => lookupEndpointsForBase(index, target.trim(), "send"),
    [index, target],
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
    if (!targetValid) {
      setEndpoint("");
      setFormData({});
      setJsonCustomized(false);
      return;
    }
    if (sendEndpoints.length === 1 && endpoint === "") {
      setEndpoint(sendEndpoints[0]!.suffix);
    }
  }, [targetValid, sendEndpoints, endpoint]);

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
    if (mqtt == undefined || !targetValid || endpoint.trim() === "") {
      return;
    }
    const topic = buildTopic(target.trim(), endpoint.trim());
    mqtt.publish(topic, formData, 0, false);
    onSend(Date.now());
  }, [mqtt, targetValid, endpoint, target, formData, onSend]);

  return (
    <section className={classes.section}>
      <Typography variant="subtitle2" className={classes.sectionTitle}>
        Send
      </Typography>

      <Autocomplete
        freeSolo
        size="small"
        options={baseOptions}
        value={target}
        onInputChange={(_e, value) => {
          setTarget(value);
          setEndpoint("");
          setJsonCustomized(false);
        }}
        onChange={(_e, value) => {
          setTarget(value ?? "");
          setEndpoint("");
          setJsonCustomized(false);
        }}
        renderInput={(params) => (
          <TextField {...params} label="Component" placeholder="serviceId or serviceId/channelId" />
        )}
      />

      <Autocomplete
        freeSolo
        size="small"
        disabled={!targetValid}
        options={sendEndpoints.map((e) => e.suffix)}
        value={endpoint}
        onInputChange={(_e, value) => {
          setEndpoint(value);
          setJsonCustomized(false);
        }}
        onChange={(_e, value) => {
          setEndpoint(value ?? "");
          setJsonCustomized(false);
        }}
        renderInput={(params) => (
          <TextField {...params} label="Query / command" placeholder="?/About, !/Poll, …" />
        )}
      />

      {hasSchema && selectedEndpoint != undefined && (
        <div className={classes.schemaForm}>
          <SchemaForm schema={payloadSchema!} formData={formData} onChange={handleFormChange} />
        </div>
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
        disabled={mqtt == undefined || !targetValid || endpoint.trim() === ""}
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
