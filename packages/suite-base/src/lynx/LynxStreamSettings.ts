// SPDX-License-Identifier: MPL-2.0

import { buildStreamPayload, type StreamRequestInput } from "lynx-sdk-typescript";

import type { JsonSchema } from "@lichtblick/suite-base/lynx/types";

/**
 * What a user asked for when streaming one Channel: the fields of the `!/Stream` request
 * (A3.0 section 11.3). Every field is optional; an omitted field takes the default below.
 * `contents` is an explicit override: when absent, `contents` follows what the open panels plot.
 */
export interface LynxStreamSettings {
  sampleInterval?: number;
  numSamples?: number;
  batch?: { maxInterval?: number; maxSamples?: number };
  contents?: boolean | Record<string, unknown>;
}

/**
 * The dash's own defaults. They differ from the protocol's (one sample per second, one per
 * message) only in sampling faster, which suits a live display.
 */
export const DEFAULT_STREAM_SETTINGS: Readonly<LynxStreamSettings> = { sampleInterval: 0.25 };

const STORAGE_KEY = "lynx:streamSettings";

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != undefined && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number != undefined && Number.isInteger(number) ? number : undefined;
}

/** Keep only well-formed fields, so a hand-edited or old stored value cannot break a request. */
export function sanitizeStreamSettings(raw: unknown): LynxStreamSettings {
  if (!isRecord(raw)) {
    return {};
  }
  const out: LynxStreamSettings = {};
  const sampleInterval = finiteNumber(raw.sampleInterval);
  if (sampleInterval != undefined) {
    out.sampleInterval = sampleInterval;
  }
  const numSamples = finiteInteger(raw.numSamples);
  if (numSamples != undefined) {
    out.numSamples = numSamples;
  }
  if (isRecord(raw.batch)) {
    const batch: NonNullable<LynxStreamSettings["batch"]> = {};
    const maxInterval = finiteNumber(raw.batch.maxInterval);
    if (maxInterval != undefined) {
      batch.maxInterval = maxInterval;
    }
    const maxSamples = finiteInteger(raw.batch.maxSamples);
    if (maxSamples != undefined) {
      batch.maxSamples = maxSamples;
    }
    if (Object.keys(batch).length > 0) {
      out.batch = batch;
    }
  }
  if (typeof raw.contents === "boolean" || isRecord(raw.contents)) {
    out.contents = raw.contents;
  }
  return out;
}

export function isDefaultSettings(settings: LynxStreamSettings): boolean {
  return Object.keys(sanitizeStreamSettings(settings)).length === 0;
}

/**
 * The request to send: the dash defaults, then the user's settings, then `contents` as the
 * user's override or else `derivedContents` (what the open panels plot; undefined asks for
 * everything).
 */
export function buildRequest(settings: LynxStreamSettings, derivedContents: Record<string, true> | undefined): StreamRequestInput {
  const merged: LynxStreamSettings = { ...DEFAULT_STREAM_SETTINGS, ...sanitizeStreamSettings(settings) };
  const request: StreamRequestInput = {};
  if (merged.sampleInterval != undefined) {
    request.sampleInterval = merged.sampleInterval;
  }
  if (merged.numSamples != undefined) {
    request.numSamples = merged.numSamples;
  }
  if (merged.batch != undefined) {
    request.batch = { ...merged.batch };
  }
  const contents = merged.contents ?? derivedContents;
  if (contents != undefined && contents !== true) {
    request.contents = contents;
  }
  // Throws for a value the protocol forbids, so a bad setting fails here and not on the wire.
  buildStreamPayload(request);
  return request;
}

/**
 * The names of the fields in a Channel's samples, read from its `<` payload schema (an array
 * of `{ s, ns, data }`). Undefined when the schema does not say.
 */
export function dataFieldNames(payloadSchema: JsonSchema | undefined): string[] | undefined {
  const items = payloadSchema?.items;
  if (!isRecord(items) || !isRecord(items.properties)) {
    return undefined;
  }
  const data = items.properties.data;
  if (!isRecord(data) || !isRecord(data.properties)) {
    return undefined;
  }
  return Object.keys(data.properties);
}

/**
 * The `contents` filter for the fields subscribers asked for. `wanted` holds one entry per
 * subscription: its field names, or undefined for a subscription to whole messages.
 *
 * Panels also ask for fields Lynx samples do not have (such as `header`), and a `contents`
 * that names a field that does not exist makes the Channel discard the sample, so only names
 * the Channel declares are kept. Whole-message subscribers, an unknown schema, or no field in
 * common all mean "everything" (undefined).
 */
export function deriveContents(
  wanted: ReadonlyArray<readonly string[] | undefined>,
  available: readonly string[] | undefined,
): Record<string, true> | undefined {
  if (available == undefined || wanted.length === 0 || wanted.some((fields) => fields == undefined)) {
    return undefined;
  }
  const names = new Set(available);
  const selected = new Set<string>();
  for (const fields of wanted) {
    for (const field of fields ?? []) {
      if (names.has(field)) {
        selected.add(field);
      }
    }
  }
  if (selected.size === 0 || selected.size === names.size) {
    return undefined;
  }
  return Object.fromEntries([...selected].sort().map((name) => [name, true as const]));
}

/** Persistent, per-Channel stream settings, keyed by the Channel's data topic. */
export class LynxStreamSettingsStore {
  readonly #storage: StorageLike | undefined;
  readonly #settings = new Map<string, LynxStreamSettings>();
  readonly #listeners = new Set<(topic: string) => void>();

  public constructor(storage?: StorageLike) {
    this.#storage = storage;
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (raw != undefined) {
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed)) {
          for (const [topic, value] of Object.entries(parsed)) {
            const clean = sanitizeStreamSettings(value);
            if (!isDefaultSettings(clean)) {
              this.#settings.set(topic, clean);
            }
          }
        }
      }
    } catch {
      // Unreadable storage: start with defaults.
    }
  }

  /** What the user set for `topic`; empty when they set nothing. */
  public get(topic: string): LynxStreamSettings {
    return structuredClone(this.#settings.get(topic) ?? {});
  }

  /** Replace the settings for `topic`. Empty settings remove the entry. */
  public set(topic: string, settings: LynxStreamSettings): void {
    const clean = sanitizeStreamSettings(settings);
    if (isDefaultSettings(clean)) {
      this.#settings.delete(topic);
    } else {
      this.#settings.set(topic, clean);
    }
    this.#persist();
    for (const listener of [...this.#listeners]) {
      listener(topic);
    }
  }

  public subscribe(listener: (topic: string) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #persist(): void {
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.#settings)) ?? "{}");
    } catch {
      // Best effort: the settings still apply for this session.
    }
  }
}
