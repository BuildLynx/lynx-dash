// SPDX-License-Identifier: MPL-2.0

import { Button, MenuItem, TextField, Typography } from "@mui/material";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { describeRequest } from "@lichtblick/suite-base/lynx/LynxChannelHub";
import { DEFAULT_STREAM_SETTINGS } from "@lichtblick/suite-base/lynx/LynxStreamSettings";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import {
  contentsModeOf,
  parseStreamForm,
  settingsToForm,
  streamFormFields,
  type ContentsMode,
} from "@lichtblick/suite-base/lynx/lynxStreamForm";
import type { LynxChannelView } from "@lichtblick/suite-base/lynx/types";
import { useLynxChannelRuntime } from "@lichtblick/suite-base/lynx/useLynxHub";

import { useStyles } from "./LynxNetworkSidebar.style";

export type ChannelStreamSettingsProps = {
  channel: LynxChannelView;
};

/** What the dash is doing with the Channel, in a sentence. */
export function describeStreamState(
  runtime: ReturnType<typeof useLynxChannelRuntime>,
  command: LynxChannelView["command"],
): string {
  if (runtime?.componentDown === true) {
    return "The component is not connected.";
  }
  if (command != undefined && command.command !== "Stream") {
    return `Busy with ${command.command}.`;
  }
  if (runtime?.ownership === "own") {
    return `Streaming, started by this dash (${describeRequest(runtime.running ?? {})}).`;
  }
  if (runtime?.ownership === "shared") {
    return `Streaming, started by another consumer (${describeRequest(runtime.running ?? {})}). This dash is only listening.`;
  }
  if (runtime?.starting === true) {
    return "Starting…";
  }
  if (runtime?.paused === true) {
    return "Stopped by you. It stays stopped until you start it again.";
  }
  if (runtime?.wanted === true) {
    return "Wanted by a panel; starting.";
  }
  return "Not streaming. Nothing is plotting this Channel.";
}

function ChannelStreamSettingsComponent({ channel }: ChannelStreamSettingsProps): React.JSX.Element {
  const { classes } = useStyles();
  const session = useLynxRuntimeStore((s) => s.session);
  const runtime = useLynxChannelRuntime(channel.dataTopic);
  const topic = channel.dataTopic;

  const form = useMemo(() => streamFormFields(channel.streamRequestSchema), [channel.streamRequestSchema]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [contentsMode, setContentsMode] = useState<ContentsMode>("auto");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // Load what was saved for this Channel, and follow changes made elsewhere.
  useEffect(() => {
    if (session == undefined || topic == undefined) {
      return;
    }
    const load = (): void => {
      const saved = session.settings.get(topic);
      setValues(settingsToForm(saved, form));
      setContentsMode(contentsModeOf(saved));
      setErrors({});
      setDirty(false);
    };
    load();
    return session.settings.subscribe((changed) => {
      if (changed === topic) {
        load();
      }
    });
  }, [session, topic, form]);

  const handleField = useCallback((key: string, text: string) => {
    setValues((previous) => ({ ...previous, [key]: text }));
    setDirty(true);
  }, []);

  const handleApply = useCallback(() => {
    if (session == undefined || topic == undefined) {
      return;
    }
    const parsed = parseStreamForm(form, values, contentsMode);
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length > 0) {
      return;
    }
    session.settings.set(topic, parsed.settings);
  }, [session, topic, form, values, contentsMode]);

  const handleReset = useCallback(() => {
    if (session == undefined || topic == undefined) {
      return;
    }
    session.settings.set(topic, {});
  }, [session, topic]);

  if (topic == undefined || channel.topics?.stream == undefined) {
    return (
      <Typography variant="caption" color="text.secondary" display="block" className={classes.spaced}>
        This Channel cannot stream.
      </Typography>
    );
  }

  const streaming = channel.command?.command === "Stream";
  const stateText = describeStreamState(runtime, channel.command);
  // Applying new settings restarts a Stream this dash started; a shared one is replaced only on request.
  const canReplace = runtime?.ownership === "shared";

  return (
    <div>
      <Typography variant="subtitle2" className={classes.spaced}>
        Stream
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        {stateText}
      </Typography>

      <div className={classes.actionRow}>
        {streaming ? (
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              session?.hub.stop(topic);
            }}
          >
            Stop stream
          </Button>
        ) : (
          <Button
            size="small"
            variant="outlined"
            disabled={runtime?.componentDown === true || (channel.command != undefined && !streaming)}
            onClick={() => {
              session?.hub.start(topic);
            }}
          >
            Start stream
          </Button>
        )}
        {canReplace && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              void session?.hub.restart(topic);
            }}
            title="Stop the running Stream and start one with this dash's settings"
          >
            Replace with my settings
          </Button>
        )}
      </div>

      {form.fields.length === 0 && !form.acceptsContents ? (
        <Typography variant="caption" color="text.secondary" display="block">
          This Channel does not list any stream settings.
        </Typography>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary" display="block">
            Settings for this Channel, kept in this browser. Empty means the default.
          </Typography>
          <div className={classes.formGrid}>
            {form.fields.map((field) => {
              const dashDefault = field.key === "sampleInterval" ? DEFAULT_STREAM_SETTINGS.sampleInterval : undefined;
              const placeholder = field.effectiveDefault != undefined ? String(field.effectiveDefault) : "";
              return (
                <TextField
                  key={field.key}
                  size="small"
                  label={field.label}
                  value={values[field.key] ?? ""}
                  placeholder={placeholder}
                  error={errors[field.key] != undefined}
                  helperText={errors[field.key] ?? `${field.helper}${dashDefault != undefined ? ` Dash default ${dashDefault}.` : ""}`}
                  onChange={(event) => {
                    handleField(field.key, event.target.value);
                  }}
                  slotProps={{ htmlInput: { inputMode: "decimal" } }}
                />
              );
            })}
            {form.acceptsContents && (
              <TextField
                select
                size="small"
                label="Fields to send"
                value={contentsMode}
                onChange={(event) => {
                  setContentsMode(event.target.value as ContentsMode);
                  setDirty(true);
                }}
                helperText="Automatic asks only for the fields that panels plot."
              >
                <MenuItem value="auto">Automatic (plotted fields)</MenuItem>
                <MenuItem value="all">Always all fields</MenuItem>
              </TextField>
            )}
            <div className={classes.buttonRow}>
              <Button size="small" variant="contained" disabled={!dirty} onClick={handleApply}>
                Apply
              </Button>
              <Button size="small" onClick={handleReset}>
                Reset to defaults
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export const ChannelStreamSettings = memo(ChannelStreamSettingsComponent);
