// SPDX-License-Identifier: MPL-2.0

import {
  buildChannelPayloadSchemaFromData,
  extractChannelOutputPayloadSchema,
  extractDataPropertiesFromChannelPayloadSchema,
  jsonSchemaToMessageDefs,
} from "@lichtblick/suite-base/lynx/jsonSchemaToMessageDefinition";
import type { JsonSchema, LynxChannelAbout } from "@lichtblick/suite-base/lynx/types";

/** Mirrors lynx_sdk CHANNEL_OUT_DATA_ENDPOINT_ARGS + LabJack AIN output_data_schema. */
const LABJACK_AIN0_PAYLOAD_SCHEMA: JsonSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      s: { type: "integer" },
      ns: { type: "integer" },
      data: {
        type: "object",
        properties: {
          ain: { type: "integer" },
          voltage: { type: "number", minimum: -10, maximum: 10 },
        },
      },
    },
  },
};

const LABJACK_AIN0_CHANNEL: LynxChannelAbout = {
  lynxType: "Channel",
  docs: {
    id: "AIN0",
    title: "Analog input AIN0",
    description: "",
    lynx_version: "A-01.01",
  },
  status: { state: "idle" },
  endpoints: {
    "labjackTSeries/AIN0/<": {
      endpoint_direction: "pub",
      payload_schema: LABJACK_AIN0_PAYLOAD_SCHEMA,
    },
  },
};

describe("jsonSchemaToMessageDefinition", () => {
  it("extracts channel output payload schema from full endpoint key", () => {
    expect(
      extractChannelOutputPayloadSchema("labjackTSeries", "AIN0", LABJACK_AIN0_CHANNEL),
    ).toEqual(LABJACK_AIN0_PAYLOAD_SCHEMA);
  });

  it("extracts data.properties from channel output schema", () => {
    const payloadSchema = extractChannelOutputPayloadSchema(
      "labjackTSeries",
      "AIN0",
      LABJACK_AIN0_CHANNEL,
    );
    expect(payloadSchema).toBeDefined();
    expect(extractDataPropertiesFromChannelPayloadSchema(payloadSchema!)).toEqual({
      ain: { type: "integer" },
      voltage: { type: "number", minimum: -10, maximum: 10 },
    });
  });

  it("builds channel payload schema from live sample data", () => {
    const payloadSchema = buildChannelPayloadSchemaFromData({ ain: 0, voltage: 1.5 });
    const { definitions } = jsonSchemaToMessageDefs("lynx/labjackTSeries/AIN0", payloadSchema);
    expect(definitions).toEqual(
      expect.arrayContaining([
        { name: "ain", type: "int32" },
        { name: "voltage", type: "float64" },
      ]),
    );
  });

  it("converts LabJack channel schema to plotable message definition fields", () => {
    const payloadSchema = extractChannelOutputPayloadSchema(
      "labjackTSeries",
      "AIN0",
      LABJACK_AIN0_CHANNEL,
    )!;
    const { definitions } = jsonSchemaToMessageDefs("lynx/labjackTSeries/AIN0", payloadSchema);
    expect(definitions).toEqual(
      expect.arrayContaining([
        { name: "ain", type: "int32" },
        { name: "voltage", type: "float64" },
      ]),
    );
  });
});
