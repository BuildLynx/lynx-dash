// SPDX-License-Identifier: MPL-2.0

import {
  buildChannelPayloadSchemaFromData,
  extractDataPropertiesFromChannelPayloadSchema,
  jsonSchemaToMessageDefs,
  schemaType,
} from "@lichtblick/suite-base/lynx/jsonSchemaToMessageDefinition";
import type { JsonSchema } from "@lichtblick/suite-base/lynx/types";

import fixtures from "./__fixtures__/live-about.json";

type Channels = Record<string, { endpoints: Record<string, { payload_schema: JsonSchema }> }>;

/** The `<` payload schema of a real Channel captured from a live A3.0 Service. */
function liveSchema(channelKey: string): JsonSchema {
  const svc = "slicesCore-46534b98";
  const channels = (fixtures.slicesCore as unknown as { channels: Channels }).channels;
  return channels[channelKey]!.endpoints[`${svc}/${channelKey}/<`]!.payload_schema;
}

/** A `<` schema (array of `{ s, ns, data }`) around the given data properties. */
function samples(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "array",
    items: {
      type: "object",
      properties: { s: { type: "integer" }, ns: { type: "integer" }, data: { type: "object", properties } },
    },
  };
}

describe("schemaType", () => {
  it("reads a plain type", () => {
    expect(schemaType({ type: "number" })).toBe("number");
    expect(schemaType({ type: "boolean" })).toBe("boolean");
  });

  it("ignores null in a type list", () => {
    expect(schemaType({ type: ["number", "null"] })).toBe("number");
    expect(schemaType({ type: ["null", "integer"] })).toBe("integer");
    expect(schemaType({ type: ["string"] })).toBe("string");
  });

  it("treats integer-or-number as number", () => {
    expect(schemaType({ type: ["integer", "number", "null"] })).toBe("number");
  });

  it("gives up on a type it cannot express", () => {
    expect(schemaType({ type: ["object", "boolean"] })).toBeUndefined();
    expect(schemaType({ type: "null" })).toBeUndefined();
    expect(schemaType({ type: ["null"] })).toBeUndefined();
    expect(schemaType({})).toBeUndefined();
  });
});

describe("jsonSchemaToMessageDefs with real A3.0 Channel schemas", () => {
  it("keeps a nullable number as a plottable float64 (this is what the old converter dropped)", () => {
    const { definitions } = jsonSchemaToMessageDefs("lynx/x/rail5v", liveSchema("441BF6D79ADC-rail5v"));
    expect(definitions).toEqual([{ name: "rail5v", type: "float64" }]);
  });

  it("converts another nullable number", () => {
    const { definitions } = jsonSchemaToMessageDefs("lynx/x/force", liveSchema("EEED28C829A163DE-force"));
    expect(definitions).toEqual([{ name: "force", type: "float64" }]);
  });

  it("converts an integer and a boolean", () => {
    expect(jsonSchemaToMessageDefs("lynx/x/lynx", liveSchema("441BF6D79ADC-lynx")).definitions).toEqual([
      { name: "lynx", type: "int32" },
    ]);
    expect(jsonSchemaToMessageDefs("lynx/x/led", liveSchema("44E3FAAD6691C441-led")).definitions).toEqual([
      { name: "led", type: "bool" },
    ]);
  });

  it("extracts the data properties, including the unit written in the description", () => {
    const props = extractDataPropertiesFromChannelPayloadSchema(liveSchema("441BF6D79ADC-rail5v"));
    expect(props).toEqual({ rail5v: { type: ["number", "null"], description: "In V." } });
  });
});

describe("jsonSchemaToMessageDefs", () => {
  it("converts nested objects and arrays, nullable or not", () => {
    const schema = samples({
      pose: { type: "object", properties: { x: { type: ["number", "null"] }, y: { type: "number" } } },
      taps: { type: ["array", "null"], items: { type: ["integer", "null"] } },
      readings: { type: "array", items: { type: "object", properties: { v: { type: ["number", "null"] } } } },
    });
    const { definitions, nested } = jsonSchemaToMessageDefs("lynx/x/c", schema);
    expect(definitions).toEqual([
      { name: "pose", type: "lynx/x/c.pose", isComplex: true },
      { name: "taps", type: "int32", isArray: true },
      { name: "readings", type: "lynx/x/c.readings", isComplex: true, isArray: true },
    ]);
    expect(nested.get("lynx/x/c.pose")?.definitions).toEqual([
      { name: "x", type: "float64" },
      { name: "y", type: "float64" },
    ]);
    expect(nested.get("lynx/x/c.readings")?.definitions).toEqual([{ name: "v", type: "float64" }]);
  });

  it("uses an unsigned type for a non-negative integer", () => {
    const { definitions } = jsonSchemaToMessageDefs("lynx/x/c", samples({ n: { type: "integer", minimum: 0 } }));
    expect(definitions).toEqual([{ name: "n", type: "uint32" }]);
  });

  it("leaves out a field whose type it cannot express, and keeps the rest", () => {
    const { definitions } = jsonSchemaToMessageDefs(
      "lynx/x/c",
      samples({ mixed: { type: ["object", "boolean"] }, ok: { type: "string" } }),
    );
    expect(definitions).toEqual([{ name: "ok", type: "string" }]);
  });

  it("returns nothing for a schema that does not describe samples", () => {
    expect(jsonSchemaToMessageDefs("lynx/x/c", { type: "object" }).definitions).toEqual([]);
  });
});

describe("buildChannelPayloadSchemaFromData", () => {
  it("builds fields from a live sample", () => {
    const payloadSchema = buildChannelPayloadSchemaFromData({ ain: 0, voltage: 1.5, on: true, label: "a" });
    const { definitions } = jsonSchemaToMessageDefs("lynx/x/c", payloadSchema);
    expect(definitions).toEqual(
      expect.arrayContaining([
        { name: "ain", type: "int32" },
        { name: "voltage", type: "float64" },
        { name: "on", type: "bool" },
        { name: "label", type: "string" },
      ]),
    );
  });

  it("leaves out a field that is null in the sample, since nothing says what it is", () => {
    const payloadSchema = buildChannelPayloadSchemaFromData({ force: null, other: 2 });
    const { definitions } = jsonSchemaToMessageDefs("lynx/x/c", payloadSchema);
    expect(definitions).toEqual([{ name: "other", type: "int32" }]);
  });
});
