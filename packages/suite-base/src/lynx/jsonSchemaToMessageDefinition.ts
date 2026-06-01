// SPDX-License-Identifier: MPL-2.0

import { MessageDefinitionField } from "@lichtblick/message-definition";

import type { JsonSchema, LynxChannelAbout, LynxEndpointAbout } from "@lichtblick/suite-base/lynx/types";
import type { OptionalMessageDefinition } from "@lichtblick/suite-base/types/RosDatatypes";

function readEndpointPayloadSchema(endpoint: LynxEndpointAbout | undefined): JsonSchema | undefined {
  if (endpoint == undefined) {
    return undefined;
  }
  const schema = endpoint.payload_schema;
  if (schema != undefined && schema != null) {
    return schema;
  }
  const alt = (endpoint as unknown as Record<string, unknown>).payloadSchema;
  if (typeof alt === "object" && alt != null) {
    return alt as JsonSchema;
  }
  return undefined;
}

export function extractChannelOutputPayloadSchema(
  serviceId: string,
  channelId: string,
  channel: LynxChannelAbout,
): JsonSchema | undefined {
  const endpoints = channel.endpoints;
  if (!endpoints) {
    return undefined;
  }

  const fullKey = `${serviceId}/${channelId}/<`;
  const direct = readEndpointPayloadSchema(endpoints[fullKey]);
  if (direct != undefined) {
    return direct;
  }

  const short = readEndpointPayloadSchema(endpoints["<"]);
  if (short != undefined) {
    return short;
  }

  for (const [key, endpoint] of Object.entries(endpoints)) {
    if (key.endsWith("/<")) {
      const schema = readEndpointPayloadSchema(endpoint);
      if (schema != undefined) {
        return schema;
      }
    }
  }

  return undefined;
}

function valueToJsonSchemaField(value: unknown): JsonSchema | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return { type: "boolean" };
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
  }
  if (typeof value === "string") {
    return { type: "string" };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const fieldSchema = valueToJsonSchemaField(nested);
      if (fieldSchema != undefined) {
        properties[key] = fieldSchema;
      }
    }
    return { type: "object", properties };
  }
  return undefined;
}

/** Build a Lynx `<` endpoint payload_schema from a live `sample.data` object. */
export function buildChannelPayloadSchemaFromData(data: Record<string, unknown>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [key, value] of Object.entries(data)) {
    const fieldSchema = valueToJsonSchemaField(value);
    if (fieldSchema != undefined) {
      properties[key] = fieldSchema;
    }
  }
  return {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        s: { type: "integer" },
        ns: { type: "integer" },
        data: { type: "object", properties },
      },
    },
  };
}

/** Navigate Lynx `<` endpoint payload_schema to channel `data.properties`. */
function asJsonSchema(value: unknown): JsonSchema | undefined {
  if (typeof value === "object" && value != null) {
    return value as JsonSchema;
  }
  return undefined;
}

export function extractDataPropertiesFromChannelPayloadSchema(
  payloadSchema: JsonSchema,
): Record<string, JsonSchema> | undefined {
  try {
    const items = asJsonSchema(payloadSchema.items);
    if (!items) {
      return undefined;
    }
    const itemProps = asJsonSchema(items.properties);
    if (!itemProps) {
      return undefined;
    }
    const data = asJsonSchema(itemProps.data);
    if (!data) {
      return undefined;
    }
    const props = data.properties;
    if (props == undefined) {
      return {};
    }
    if (typeof props !== "object" || props == null) {
      return undefined;
    }
    return props as Record<string, JsonSchema>;
  } catch {
    return undefined;
  }
}

function integerRosType(fieldSchema: JsonSchema): string {
  const minimum = fieldSchema.minimum;
  const exclusiveMinimum = fieldSchema.exclusiveMinimum;
  if (typeof minimum === "number" && minimum >= 0) {
    return "uint32";
  }
  if (typeof exclusiveMinimum === "number" && exclusiveMinimum >= 0) {
    return "uint32";
  }
  return "int32";
}

function convertField(
  fieldName: string,
  fieldSchema: JsonSchema,
  parentTypeName: string,
  nested: Map<string, OptionalMessageDefinition>,
): MessageDefinitionField | undefined {
  const fieldType = fieldSchema.type;

  if (fieldType === "boolean") {
    return { name: fieldName, type: "bool" };
  }
  if (fieldType === "string") {
    return { name: fieldName, type: "string" };
  }
  if (fieldType === "number") {
    return { name: fieldName, type: "float64" };
  }
  if (fieldType === "integer") {
    return { name: fieldName, type: integerRosType(fieldSchema) };
  }
  if (fieldType === "object") {
    const nestedTypeName = `${parentTypeName}.${fieldName}`;
    const nestedFields = convertProperties(fieldSchema, nestedTypeName, nested);
    nested.set(nestedTypeName, { name: nestedTypeName, definitions: nestedFields });
    return { name: fieldName, type: nestedTypeName, isComplex: true };
  }
  if (fieldType === "array") {
    const items = asJsonSchema(fieldSchema.items);
    if (!items) {
      return undefined;
    }
    const itemType = items.type;
    if (itemType === "boolean") {
      return { name: fieldName, type: "bool", isArray: true };
    }
    if (itemType === "string") {
      return { name: fieldName, type: "string", isArray: true };
    }
    if (itemType === "number") {
      return { name: fieldName, type: "float64", isArray: true };
    }
    if (itemType === "integer") {
      return { name: fieldName, type: integerRosType(items as JsonSchema), isArray: true };
    }
    if (itemType === "object") {
      const nestedTypeName = `${parentTypeName}.${fieldName}`;
      const nestedFields = convertProperties(items as JsonSchema, nestedTypeName, nested);
      nested.set(nestedTypeName, { name: nestedTypeName, definitions: nestedFields });
      return { name: fieldName, type: nestedTypeName, isComplex: true, isArray: true };
    }
    return undefined;
  }

  return undefined;
}

function convertProperties(
  schema: JsonSchema,
  typeName: string,
  nested: Map<string, OptionalMessageDefinition>,
): MessageDefinitionField[] {
  const properties = schema.properties;
  if (typeof properties !== "object" || properties == null) {
    return [];
  }

  const fields: MessageDefinitionField[] = [];
  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    if (typeof fieldSchema !== "object" || fieldSchema == null) {
      continue;
    }
    const field = convertField(fieldName, fieldSchema as JsonSchema, typeName, nested);
    if (field) {
      fields.push(field);
    }
  }
  return fields;
}

/**
 * Convert a Lynx channel `<` endpoint payload_schema into Lichtblick message-definition fields
 * for the channel data object (`sample.data`).
 */
export function jsonSchemaToMessageDefs(
  schemaName: string,
  payloadSchema: JsonSchema,
): { definitions: MessageDefinitionField[]; nested: Map<string, OptionalMessageDefinition> } {
  const nested = new Map<string, OptionalMessageDefinition>();
  const dataProperties = extractDataPropertiesFromChannelPayloadSchema(payloadSchema);
  if (dataProperties == undefined) {
    return { definitions: [], nested };
  }

  const dataSchema: JsonSchema = { type: "object", properties: dataProperties };
  const definitions = convertProperties(dataSchema, schemaName, nested);
  return { definitions, nested };
}
