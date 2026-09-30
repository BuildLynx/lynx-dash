// SPDX-License-Identifier: MPL-2.0

import { parseMessagePath } from "@lichtblick/message-path";
import type { MessagePathPart } from "@lichtblick/message-path/src/types";
import { extractDataPropertiesFromChannelPayloadSchema } from "@lichtblick/suite-base/lynx/jsonSchemaToMessageDefinition";
import { findChannelByDataTopic, type LynxNetworkSnapshot } from "@lichtblick/suite-base/lynx/types";
import type { PlotPath } from "@lichtblick/suite-base/panels/Plot/utils/config";
import type { Topic } from "@lichtblick/suite-base/players/types";

export const LYNX_SCHEMA_PREFIX = "lynx/";

const typeIsName = (part: MessagePathPart): boolean => part.type === "name";

export function isLynxSchemaTopic(topic: Topic | undefined): boolean {
  return topic?.schemaName?.startsWith(LYNX_SCHEMA_PREFIX) === true;
}

export function isLynxMessagePath(pathValue: string, topicsByName: ReadonlyMap<string, Topic>): boolean {
  const parsed = parseMessagePath(pathValue);
  if (!parsed) {
    return false;
  }
  return isLynxSchemaTopic(topicsByName.get(parsed.topicName));
}

/** The title of the Channel that publishes on `dataTopic`. */
export function getChannelTitle(snapshot: LynxNetworkSnapshot | undefined, dataTopic: string): string | undefined {
  if (snapshot == undefined) {
    return undefined;
  }
  return findChannelByDataTopic(snapshot, dataTopic)?.title;
}

export function getChannelTitleForPath(pathValue: string, snapshot: LynxNetworkSnapshot | undefined): string | undefined {
  const parsed = parseMessagePath(pathValue);
  if (!parsed) {
    return undefined;
  }
  return getChannelTitle(snapshot, parsed.topicName);
}

export function getPlottedFieldName(pathValue: string): string | undefined {
  const parsed = parseMessagePath(pathValue);
  if (!parsed) {
    return undefined;
  }
  const firstField = parsed.messagePath.find(typeIsName);
  if (firstField?.type !== "name") {
    return undefined;
  }
  return firstField.name;
}

export type FieldSchemaBounds = {
  min: number;
  max: number;
};

/** The `minimum` and `maximum` a Channel's schema declares for the plotted field, when both exist. */
export function getPlottedFieldSchemaBounds(
  pathValue: string,
  snapshot: LynxNetworkSnapshot | undefined,
): FieldSchemaBounds | undefined {
  const parsed = parseMessagePath(pathValue);
  if (!parsed || snapshot == undefined) {
    return undefined;
  }
  const fieldName = getPlottedFieldName(pathValue);
  if (fieldName == undefined || fieldName.length === 0) {
    return undefined;
  }
  const channel = findChannelByDataTopic(snapshot, parsed.topicName);
  if (channel?.payloadSchema == undefined) {
    return undefined;
  }
  const dataProperties = extractDataPropertiesFromChannelPayloadSchema(channel.payloadSchema);
  const fieldSchema = dataProperties?.[fieldName];
  if (fieldSchema == undefined) {
    return undefined;
  }
  const { minimum, maximum } = fieldSchema;
  if (typeof minimum !== "number" || typeof maximum !== "number") {
    return undefined;
  }
  return { min: minimum, max: maximum };
}

/** Aggregated Y bounds when every enabled series has schema min/max; otherwise undefined. */
export function computeLynxPlotSchemaYBounds(
  paths: readonly PlotPath[],
  snapshot: LynxNetworkSnapshot | undefined,
): FieldSchemaBounds | undefined {
  let min: number | undefined;
  let max: number | undefined;

  for (const path of paths) {
    if (!path.enabled || path.value.length === 0) {
      continue;
    }
    const bounds = getPlottedFieldSchemaBounds(path.value, snapshot);
    if (bounds == undefined) {
      return undefined;
    }
    min = min == undefined ? bounds.min : Math.min(min, bounds.min);
    max = max == undefined ? bounds.max : Math.max(max, bounds.max);
  }

  if (min == undefined || max == undefined) {
    return undefined;
  }
  return { min, max };
}

export function applyLynxPlotYBounds(
  config: {
    paths: PlotPath[];
    minYValue?: string | number;
    maxYValue?: string | number;
  },
  snapshot: LynxNetworkSnapshot | undefined,
): { minYValue?: string | number; maxYValue?: string | number } {
  const schemaBounds = computeLynxPlotSchemaYBounds(config.paths, snapshot);
  if (schemaBounds == undefined) {
    return {
      minYValue: config.minYValue,
      maxYValue: config.maxYValue,
    };
  }
  return {
    minYValue: config.minYValue ?? schemaBounds.min,
    maxYValue: config.maxYValue ?? schemaBounds.max,
  };
}
