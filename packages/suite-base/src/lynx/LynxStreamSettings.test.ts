// SPDX-License-Identifier: MPL-2.0

import {
  DEFAULT_STREAM_SETTINGS,
  LynxStreamSettingsStore,
  buildRequest,
  dataFieldNames,
  deriveContents,
  sanitizeStreamSettings,
  type StorageLike,
} from "./LynxStreamSettings";
import fixtures from "./__fixtures__/live-about.json";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("buildRequest", () => {
  it("uses the dash defaults when the user set nothing", () => {
    expect(buildRequest({}, undefined)).toEqual({ sampleInterval: DEFAULT_STREAM_SETTINGS.sampleInterval });
  });

  it("lets the user's settings win over the defaults, per field", () => {
    expect(
      buildRequest({ sampleInterval: 0.01, batch: { maxSamples: 50, maxInterval: 2 }, numSamples: 1000 }, undefined),
    ).toEqual({ sampleInterval: 0.01, numSamples: 1000, batch: { maxSamples: 50, maxInterval: 2 } });
  });

  it("keeps a zero: it means as fast as possible / no time-based flush", () => {
    expect(buildRequest({ sampleInterval: 0, batch: { maxInterval: 0 } }, undefined)).toEqual({
      sampleInterval: 0,
      batch: { maxInterval: 0 },
    });
  });

  it("asks only for the fields the panels plot, unless the user overrode contents", () => {
    expect(buildRequest({}, { rail5v: true }).contents).toEqual({ rail5v: true });
    expect(buildRequest({ contents: true }, { rail5v: true }).contents).toBeUndefined();
    expect(buildRequest({ contents: { force: true } }, { rail5v: true }).contents).toEqual({ force: true });
    expect(buildRequest({ contents: false }, undefined).contents).toBe(false);
  });

  it("drops malformed settings instead of sending them", () => {
    const request = buildRequest({ sampleInterval: -1, numSamples: 1.5 } as never, undefined);
    expect(request).toEqual({ sampleInterval: DEFAULT_STREAM_SETTINGS.sampleInterval });
  });
});

describe("sanitizeStreamSettings", () => {
  it("keeps well-formed fields and drops the rest", () => {
    expect(
      sanitizeStreamSettings({
        sampleInterval: 2,
        numSamples: 3,
        batch: { maxInterval: 4, maxSamples: 5, extra: 1 },
        contents: { a: true },
        junk: true,
      }),
    ).toEqual({ sampleInterval: 2, numSamples: 3, batch: { maxInterval: 4, maxSamples: 5 }, contents: { a: true } });
    expect(sanitizeStreamSettings("nope")).toEqual({});
    expect(sanitizeStreamSettings({ batch: { maxSamples: 1.5 } })).toEqual({});
    expect(sanitizeStreamSettings({ contents: "all" })).toEqual({});
  });
});

describe("dataFieldNames", () => {
  it("reads the sample fields from a real Channel's payload schema", () => {
    const channels = (fixtures.slicesCore as unknown as { channels: Record<string, { endpoints: Record<string, { payload_schema: never }> }> }).channels;
    const rail = channels["441BF6D79ADC-rail5v"]!;
    const schema = rail.endpoints["slicesCore-46534b98/441BF6D79ADC-rail5v/<"]!.payload_schema;
    expect(dataFieldNames(schema)).toEqual(["rail5v"]);
  });

  it("is undefined when the schema does not describe the data", () => {
    expect(dataFieldNames(undefined)).toBeUndefined();
    expect(dataFieldNames({ type: "array" })).toBeUndefined();
    expect(dataFieldNames({ items: { properties: { data: { type: "object" } } } })).toBeUndefined();
  });
});

describe("deriveContents", () => {
  const available = ["a", "b", "c"];

  it("selects the union of the fields subscribers want", () => {
    expect(deriveContents([["a"], ["c", "a"]], available)).toEqual({ a: true, c: true });
  });

  it("asks for everything when any subscriber wants whole messages", () => {
    expect(deriveContents([["a"], undefined], available)).toBeUndefined();
  });

  it("asks for everything when nothing is subscribed or the schema is unknown", () => {
    expect(deriveContents([], available)).toBeUndefined();
    expect(deriveContents([["a"]], undefined)).toBeUndefined();
  });

  it("ignores fields the Channel does not declare, such as the header panels always add", () => {
    // A contents naming a missing field would make the Channel discard every sample.
    expect(deriveContents([["header", "b"]], available)).toEqual({ b: true });
  });

  it("asks for everything when no wanted field exists, or when all of them are wanted", () => {
    expect(deriveContents([["header"]], available)).toBeUndefined();
    expect(deriveContents([["a", "b", "c"]], available)).toBeUndefined();
  });
});

describe("LynxStreamSettingsStore", () => {
  it("returns empty settings for a Channel nobody configured", () => {
    expect(new LynxStreamSettingsStore(memoryStorage()).get("x/<")).toEqual({});
  });

  it("stores settings per Channel and persists them", () => {
    const storage = memoryStorage();
    const store = new LynxStreamSettingsStore(storage);
    store.set("a/<", { sampleInterval: 0.1, batch: { maxSamples: 10 } });
    store.set("b/<", { numSamples: 5 });
    expect(store.get("a/<")).toEqual({ sampleInterval: 0.1, batch: { maxSamples: 10 } });
    expect(store.get("b/<")).toEqual({ numSamples: 5 });

    const reloaded = new LynxStreamSettingsStore(storage);
    expect(reloaded.get("a/<")).toEqual({ sampleInterval: 0.1, batch: { maxSamples: 10 } });
  });

  it("removes an entry when its settings are reset to empty", () => {
    const storage = memoryStorage();
    const store = new LynxStreamSettingsStore(storage);
    store.set("a/<", { sampleInterval: 1 });
    store.set("a/<", {});
    expect(store.get("a/<")).toEqual({});
    expect(JSON.parse(storage.data["lynx:streamSettings"]!)).toEqual({});
  });

  it("returns copies, so callers cannot change what is stored", () => {
    const store = new LynxStreamSettingsStore(memoryStorage());
    store.set("a/<", { batch: { maxSamples: 3 } });
    store.get("a/<").batch!.maxSamples = 99;
    expect(store.get("a/<").batch?.maxSamples).toBe(3);
  });

  it("notifies subscribers with the topic that changed", () => {
    const store = new LynxStreamSettingsStore(memoryStorage());
    const seen: string[] = [];
    const unsubscribe = store.subscribe((topic) => seen.push(topic));
    store.set("a/<", { sampleInterval: 1 });
    unsubscribe();
    store.set("b/<", { sampleInterval: 1 });
    expect(seen).toEqual(["a/<"]);
  });

  it("survives absent, corrupt, or throwing storage", () => {
    expect(new LynxStreamSettingsStore(undefined).get("a/<")).toEqual({});
    expect(new LynxStreamSettingsStore(memoryStorage({ "lynx:streamSettings": "{not json" })).get("a/<")).toEqual({});
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const store = new LynxStreamSettingsStore(throwing);
    expect(() => {
      store.set("a/<", { sampleInterval: 2 });
    }).not.toThrow();
    expect(store.get("a/<")).toEqual({ sampleInterval: 2 });
  });

  it("drops malformed stored entries", () => {
    const storage = memoryStorage({
      "lynx:streamSettings": JSON.stringify({ "a/<": { sampleInterval: -5 }, "b/<": { sampleInterval: 2 }, "c/<": 7 }) ?? "",
    });
    const store = new LynxStreamSettingsStore(storage);
    expect(store.get("a/<")).toEqual({});
    expect(store.get("b/<")).toEqual({ sampleInterval: 2 });
    expect(store.get("c/<")).toEqual({});
  });
});
