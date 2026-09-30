// SPDX-License-Identifier: MPL-2.0

import fixtures from "./__fixtures__/live-about.json";
import { contentsModeOf, parseStreamForm, settingsToForm, streamFormFields } from "./lynxStreamForm";

type Channels = Record<string, { endpoints: Record<string, { payload_schema: Record<string, unknown> }> }>;

/** The real `!/Stream` request schema of a Channel on a live A3.0 Service. */
const REAL_STREAM_SCHEMA = (fixtures.slicesCore as unknown as { channels: Channels }).channels["441BF6D79ADC-rail5v"]!.endpoints[
  "slicesCore-46534b98/441BF6D79ADC-rail5v/!/Stream"
]!.payload_schema;

describe("streamFormFields", () => {
  it("offers exactly the settings a real Channel accepts", () => {
    const form = streamFormFields(REAL_STREAM_SCHEMA);
    expect(form.fields.map((f) => f.key)).toEqual(["sampleInterval", "numSamples", "batch.maxInterval", "batch.maxSamples"]);
    expect(form.acceptsContents).toBe(true);
  });

  it("carries the schema's defaults and limits, and the dash's own default for the interval", () => {
    const fields = Object.fromEntries(streamFormFields(REAL_STREAM_SCHEMA).fields.map((f) => [f.key, f]));
    expect(fields.sampleInterval).toMatchObject({ min: 0, schemaDefault: 1, effectiveDefault: 0.25, integer: false });
    expect(fields["batch.maxSamples"]).toMatchObject({ min: 0, schemaDefault: 1, effectiveDefault: 1, integer: true });
    expect(fields["batch.maxInterval"]).toMatchObject({ schemaDefault: 300, effectiveDefault: 300 });
    expect(fields.numSamples).toMatchObject({ integer: true, effectiveDefault: 0 });
  });

  it("leaves out a setting the Channel does not list", () => {
    const form = streamFormFields({ type: "object", properties: { sampleInterval: { type: "number", minimum: 0.1 } } });
    expect(form.fields.map((f) => f.key)).toEqual(["sampleInterval"]);
    expect(form.fields[0]!.min).toBe(0.1);
    expect(form.acceptsContents).toBe(false);
  });

  it("offers nothing for a Channel with no Stream schema", () => {
    expect(streamFormFields(undefined)).toEqual({ fields: [], acceptsContents: false });
    expect(streamFormFields({})).toEqual({ fields: [], acceptsContents: false });
  });
});

describe("parseStreamForm", () => {
  const form = streamFormFields(REAL_STREAM_SCHEMA);

  it("builds settings from the text of the fields, skipping empty ones", () => {
    const { settings, errors } = parseStreamForm(
      form,
      { sampleInterval: "0.05", numSamples: "", "batch.maxInterval": "2", "batch.maxSamples": "20" },
      "auto",
    );
    expect(errors).toEqual({});
    expect(settings).toEqual({ sampleInterval: 0.05, batch: { maxInterval: 2, maxSamples: 20 } });
  });

  it("keeps a zero, which means as fast as possible or no limit", () => {
    const { settings } = parseStreamForm(form, { sampleInterval: "0", "batch.maxSamples": "0" }, "auto");
    expect(settings).toEqual({ sampleInterval: 0, batch: { maxSamples: 0 } });
  });

  it("says what is wrong with each bad field", () => {
    const { settings, errors } = parseStreamForm(
      form,
      { sampleInterval: "-1", numSamples: "2.5", "batch.maxInterval": "soon", "batch.maxSamples": "3" },
      "auto",
    );
    expect(errors).toEqual({
      sampleInterval: "Must be at least 0",
      numSamples: "Must be a whole number",
      "batch.maxInterval": "Enter a number",
    });
    // The good field still comes through.
    expect(settings).toEqual({ batch: { maxSamples: 3 } });
  });

  it("enforces the Channel's own minimum", () => {
    const strict = streamFormFields({ properties: { sampleInterval: { type: "number", minimum: 0.5 } } });
    expect(parseStreamForm(strict, { sampleInterval: "0.1" }, "auto").errors.sampleInterval).toBe("Must be at least 0.5");
  });

  it("sets contents to everything only when asked and accepted", () => {
    expect(parseStreamForm(form, {}, "all").settings).toEqual({ contents: true });
    expect(parseStreamForm(form, {}, "auto").settings).toEqual({});
    const noContents = streamFormFields({ properties: { sampleInterval: { type: "number" } } });
    expect(parseStreamForm(noContents, {}, "all").settings).toEqual({});
  });
});

describe("settingsToForm", () => {
  const form = streamFormFields(REAL_STREAM_SCHEMA);

  it("round-trips saved settings", () => {
    const saved = { sampleInterval: 0.05, batch: { maxSamples: 20 } };
    const values = settingsToForm(saved, form);
    expect(values).toEqual({ sampleInterval: "0.05", numSamples: "", "batch.maxInterval": "", "batch.maxSamples": "20" });
    expect(parseStreamForm(form, values, "auto").settings).toEqual(saved);
  });

  it("shows nothing for settings the user never set", () => {
    expect(Object.values(settingsToForm({}, form)).every((text) => text === "")).toBe(true);
  });
});

describe("contentsModeOf", () => {
  it("is auto unless the user chose to always ask for everything", () => {
    expect(contentsModeOf({})).toBe("auto");
    expect(contentsModeOf({ contents: true })).toBe("all");
    expect(contentsModeOf({ contents: { a: true } })).toBe("auto");
  });
});
