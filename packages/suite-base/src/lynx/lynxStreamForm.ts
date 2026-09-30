// SPDX-License-Identifier: MPL-2.0

import { DEFAULT_STREAM_SETTINGS, type LynxStreamSettings } from "@lichtblick/suite-base/lynx/LynxStreamSettings";
import type { JsonSchema } from "@lichtblick/suite-base/lynx/types";

export type StreamFormKey = "sampleInterval" | "numSamples" | "batch.maxInterval" | "batch.maxSamples";

export interface StreamFormField {
  key: StreamFormKey;
  label: string;
  helper: string;
  integer: boolean;
  min: number;
  /** What the Channel does when the field is left out, from its schema. */
  schemaDefault: number | undefined;
  /** What this dash asks for when the field is left empty. */
  effectiveDefault: number | undefined;
}

export type ContentsMode = "auto" | "all";

export interface StreamForm {
  fields: StreamFormField[];
  /** Whether the Channel accepts a `contents` filter. */
  acceptsContents: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != undefined && !Array.isArray(value);
}

function numberProperty(schema: unknown): { min: number; schemaDefault: number | undefined } | undefined {
  if (!isRecord(schema)) {
    return undefined;
  }
  const min = typeof schema.minimum === "number" ? schema.minimum : 0;
  const schemaDefault = typeof schema.default === "number" ? schema.default : undefined;
  return { min, schemaDefault };
}

/**
 * The stream settings a Channel accepts, read from its `!/Stream` payload schema. A Channel that
 * does not list a setting does not get a field for it, so the form never offers what the Channel
 * would reject (A3.0 section 11.3).
 */
export function streamFormFields(schema: JsonSchema | undefined): StreamForm {
  const properties = isRecord(schema?.properties) ? schema.properties : {};
  const batch = isRecord(properties.batch) && isRecord(properties.batch.properties) ? properties.batch.properties : {};
  const fields: StreamFormField[] = [];

  const add = (
    key: StreamFormKey,
    source: unknown,
    label: string,
    helper: string,
    kind: "integer" | "number",
    dashDefault: number | undefined,
  ): void => {
    const info = numberProperty(source);
    if (info == undefined) {
      return;
    }
    fields.push({
      key,
      label,
      helper,
      integer: kind === "integer",
      min: info.min,
      schemaDefault: info.schemaDefault,
      effectiveDefault: dashDefault ?? info.schemaDefault,
    });
  };

  add("sampleInterval", properties.sampleInterval, "Sample interval (s)", "Seconds between samples. 0 means as fast as the Channel can.", "number", DEFAULT_STREAM_SETTINGS.sampleInterval);
  add("numSamples", properties.numSamples, "Number of samples", "Stop after this many samples. 0 means keep going.", "integer", undefined);
  add("batch.maxInterval", batch.maxInterval, "Send at least every (s)", "Longest wait before samples are sent. 0 turns the time limit off.", "number", undefined);
  add("batch.maxSamples", batch.maxSamples, "Samples per message", "Send after this many samples. 0 turns the count limit off.", "integer", undefined);

  return { fields, acceptsContents: "contents" in properties };
}

function read(settings: LynxStreamSettings, key: StreamFormKey): number | undefined {
  switch (key) {
    case "sampleInterval":
      return settings.sampleInterval;
    case "numSamples":
      return settings.numSamples;
    case "batch.maxInterval":
      return settings.batch?.maxInterval;
    case "batch.maxSamples":
      return settings.batch?.maxSamples;
  }
}

/** The text of each field for the settings the user saved; a field they did not set is empty. */
export function settingsToForm(settings: LynxStreamSettings, form: StreamForm): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of form.fields) {
    const value = read(settings, field.key);
    values[field.key] = value == undefined ? "" : String(value);
  }
  return values;
}

export function contentsModeOf(settings: LynxStreamSettings): ContentsMode {
  return settings.contents === true ? "all" : "auto";
}

export interface ParsedStreamForm {
  settings: LynxStreamSettings;
  /** Field key to message, for fields that cannot be used. */
  errors: Record<string, string>;
}

/** Turn the text of the form back into settings, and say what is wrong with any field. */
export function parseStreamForm(form: StreamForm, values: Record<string, string>, contentsMode: ContentsMode): ParsedStreamForm {
  const settings: LynxStreamSettings = {};
  const errors: Record<string, string> = {};

  for (const field of form.fields) {
    const text = (values[field.key] ?? "").trim();
    if (text === "") {
      continue;
    }
    const value = Number(text);
    if (!Number.isFinite(value)) {
      errors[field.key] = "Enter a number";
      continue;
    }
    if (value < field.min) {
      errors[field.key] = `Must be at least ${field.min}`;
      continue;
    }
    if (field.integer && !Number.isInteger(value)) {
      errors[field.key] = "Must be a whole number";
      continue;
    }
    switch (field.key) {
      case "sampleInterval":
        settings.sampleInterval = value;
        break;
      case "numSamples":
        settings.numSamples = value;
        break;
      case "batch.maxInterval":
        settings.batch = { ...settings.batch, maxInterval: value };
        break;
      case "batch.maxSamples":
        settings.batch = { ...settings.batch, maxSamples: value };
        break;
    }
  }

  if (form.acceptsContents && contentsMode === "all") {
    settings.contents = true;
  }
  return { settings, errors };
}
