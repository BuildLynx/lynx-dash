// SPDX-License-Identifier: MPL-2.0

import type { JsonSchema, LynxEndpointAbout } from "@lichtblick/suite-base/lynx/types";

export type LynxEndpointRef = {
  suffix: string;
  fullTopic: string;
  endpoint_direction: LynxEndpointAbout["endpoint_direction"];
  description?: string;
  payload_schema?: JsonSchema | null;
};

export type LynxComponentBase = {
  value: string;
  label: string;
};

/** Resolve endpoint map keys (full topic or short suffix) relative to a component base. */
export function collectEndpointsForBase(
  base: string,
  endpoints: Record<string, LynxEndpointAbout> | undefined,
): LynxEndpointRef[] {
  if (endpoints == undefined) {
    return [];
  }

  const results: LynxEndpointRef[] = [];
  const seen = new Set<string>();

  for (const [key, ep] of Object.entries(endpoints)) {
    if (ep == undefined) {
      continue;
    }

    let suffix: string | undefined;
    if (key === base) {
      suffix = "";
    } else if (key.startsWith(`${base}/`)) {
      suffix = key.slice(base.length + 1);
    } else if (
      !key.includes("/") ||
      key.startsWith("!") ||
      key.startsWith("?") ||
      key.startsWith("@") ||
      key === "<"
    ) {
      suffix = key;
    }

    if (suffix == undefined || seen.has(suffix)) {
      continue;
    }
    seen.add(suffix);

    const fullTopic = suffix === "" ? base : `${base}/${suffix}`;
    results.push({
      suffix,
      fullTopic,
      endpoint_direction: ep.endpoint_direction,
      description: ep.description,
      payload_schema: ep.payload_schema,
    });
  }

  return results.sort((a, b) => a.suffix.localeCompare(b.suffix));
}

export function isSendEndpoint(ref: LynxEndpointRef): boolean {
  const dir = ref.endpoint_direction;
  if (dir !== "sub" && dir !== "pubsub") {
    return false;
  }
  return ref.suffix.startsWith("?") || ref.suffix.startsWith("!");
}

export function isReceiveEndpoint(ref: LynxEndpointRef): boolean {
  const dir = ref.endpoint_direction;
  if (dir !== "pub" && dir !== "pubsub") {
    return false;
  }
  return ref.suffix.startsWith("<") || ref.suffix.startsWith("@");
}

export function getSendEndpoints(refs: LynxEndpointRef[]): LynxEndpointRef[] {
  return refs.filter(isSendEndpoint);
}

export function getReceiveEndpoints(refs: LynxEndpointRef[]): LynxEndpointRef[] {
  return refs.filter(isReceiveEndpoint);
}

export function buildTopic(base: string, endpointSuffix: string): string {
  if (endpointSuffix === "") {
    return base;
  }
  return `${base}/${endpointSuffix}`;
}

export function defaultPayloadFromSchema(schema: JsonSchema | null | undefined): Record<string, unknown> {
  if (schema == undefined) {
    return {};
  }
  const props = schema.properties;
  if (props == undefined || typeof props !== "object") {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, propSchema] of Object.entries(props)) {
    if (propSchema == undefined || typeof propSchema !== "object") {
      continue;
    }
    const prop = propSchema as Record<string, unknown>;
    if ("default" in prop) {
      result[key] = prop.default;
    } else if (prop.type === "object") {
      result[key] = defaultPayloadFromSchema(prop as JsonSchema);
    } else if (prop.type === "array") {
      result[key] = [];
    } else if (prop.type === "boolean") {
      result[key] = false;
    } else if (prop.type === "number" || prop.type === "integer") {
      result[key] = 0;
    } else if (prop.type === "string") {
      result[key] = "";
    }
  }
  return result;
}
