// SPDX-License-Identifier: MPL-2.0

import { Observer, type ChannelBatch } from "lynx-sdk-typescript";

import { LynxChannelHub, describeRequest, type LynxHubProblem } from "@lichtblick/suite-base/lynx/LynxChannelHub";
import { LynxNetwork } from "@lichtblick/suite-base/lynx/LynxNetwork";
import { LynxStreamSettingsStore, type StorageLike } from "@lichtblick/suite-base/lynx/LynxStreamSettings";
import type { LynxChannelView } from "@lichtblick/suite-base/lynx/types";

import fixtures from "./__fixtures__/live-about.json";

type Rec = Record<string, unknown>;

const SVC = "slicesCore-46534b98";
const RAIL = "441BF6D79ADC-rail5v";
const RAIL_TOPIC = `${SVC}/${RAIL}/<`;
const STREAM = `${SVC}/${RAIL}/!/Stream`;
const STOP = `${SVC}/${RAIL}/!/Stop`;
const LED = "44E3FAAD6691C441-led";
const LED_TOPIC = `${SVC}/${LED}/<`;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value) ?? "null") as T;
}

function memoryStorage(): StorageLike {
  const data: Record<string, string> = {};
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

/** The Service's About with the rail channel carrying the given sample fields. */
function aboutWithFields(fields: string[]): Rec {
  const about = clone(fixtures.slicesCore as Rec);
  const channel = (about.channels as Record<string, Rec>)[RAIL]!;
  const schema = (channel.endpoints as Record<string, Rec>)[RAIL_TOPIC]!.payload_schema as Rec;
  const data = ((schema.items as Rec).properties as Rec).data as Rec;
  data.properties = Object.fromEntries(fields.map((name) => [name, { type: "number" }]));
  data.required = fields;
  return about;
}

interface Harness {
  network: LynxNetwork;
  hub: LynxChannelHub;
  observer: Observer;
  published: Array<{ topic: string; payload: Rec }>;
  problems: Map<string, LynxHubProblem>;
  settings: LynxStreamSettingsStore;
  /** What the (simulated) Service is running on the rail channel. */
  command: () => Rec | null;
  /** Someone else starts a Stream on the rail channel. */
  otherStarts: (payload: Rec) => void;
  /** The running Stream ends. */
  ends: () => void;
  serviceDown: () => void;
  serviceUp: () => void;
  removeChannel: () => void;
  batches: Array<{ channel: LynxChannelView; batch: ChannelBatch }>;
  clock: { now: number };
  settle: () => Promise<void>;
  subscribed: string[];
  unsubscribed: string[];
}

function harness(about: Rec = clone(fixtures.slicesCore as Rec), options: { announce?: boolean } = {}): Harness {
  const observer = new Observer({ send: () => {}, logger: { error() {} } });
  const network = new LynxNetwork(observer);
  const published: Harness["published"] = [];
  const problems = new Map<string, LynxHubProblem>();
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  const clock = { now: 1_000_000 };
  let command: Rec | null = null;
  let currentAbout = about;

  const announceCommand = (value: Rec | null): void => {
    command = value;
    observer.handleMessage(`${SVC}/@/About`, { channels: { [RAIL]: { status: { command: value } } } });
  };

  const settings = new LynxStreamSettingsStore(memoryStorage());
  const hub = new LynxChannelHub({
    network,
    settings,
    now: () => clock.now,
    pendingTimeoutMs: 3000,
    transport: {
      publish: (topic, payload) => {
        published.push({ topic, payload });
        // The simulated Service: one command at a time, and it announces what it runs.
        if (topic === STREAM && command == undefined) {
          announceCommand({ command: "Stream", payload });
        } else if (topic === STOP && command != undefined) {
          announceCommand(null);
        }
      },
      subscribe: (topic) => void subscribed.push(topic),
      unsubscribe: (topic) => void unsubscribed.push(topic),
    },
  });
  hub.onProblem((key, problem) => {
    if (problem == undefined) {
      problems.delete(key);
    } else {
      problems.set(key, problem);
    }
  });
  const batches: Harness["batches"] = [];
  hub.onBatch((channel, batch) => void batches.push({ channel, batch }));

  if (options.announce !== false) {
    observer.handleMessage(`${SVC}/@/Status`, { lynxType: "Service", connected: true }, { retain: true });
    observer.handleMessage(`${SVC}/@/About`, clone(currentAbout));
  }

  return {
    network,
    hub,
    observer,
    published,
    problems,
    settings,
    command: () => command,
    otherStarts: (payload) => {
      announceCommand({ command: "Stream", payload });
    },
    ends: () => {
      announceCommand(null);
    },
    serviceDown: () => {
      observer.handleMessage(`${SVC}/@/Status`, { lynxType: "Service", connected: false }, { retain: true });
    },
    serviceUp: () => {
      observer.handleMessage(`${SVC}/@/Status`, { lynxType: "Service", connected: true }, { retain: true });
    },
    removeChannel: () => {
      const trimmed = clone(currentAbout);
      delete (trimmed.channels as Rec)[RAIL];
      currentAbout = trimmed;
      // Removal is announced with the replace marker: the whole `channels` object, plus its path.
      observer.handleMessage(`${SVC}/@/About`, { channels: clone(trimmed.channels), replace: [["channels"]] });
    },
    batches,
    clock,
    settle: async () => {
      await jest.advanceTimersByTimeAsync(100);
    },
    subscribed,
    unsubscribed,
  };
}

const streams = (h: Harness): Rec[] => h.published.filter((m) => m.topic === STREAM).map((m) => m.payload);
const stops = (h: Harness): number => h.published.filter((m) => m.topic === STOP).length;

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("LynxChannelHub: starting", () => {
  it("subscribes to a wanted Channel and starts a Stream with the dash defaults", () => {
    const h = harness();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    expect(h.subscribed).toEqual([RAIL_TOPIC]);
    expect(streams(h)).toEqual([{ sampleInterval: 0.25 }]);
    h.hub.dispose();
  });

  it("does nothing for a Channel nobody wants", () => {
    const h = harness();
    h.hub.setWanted(new Map());
    expect(h.published).toEqual([]);
    expect(h.subscribed).toEqual([]);
    h.hub.dispose();
  });

  it("uses the user's per-Channel settings", () => {
    const h = harness();
    h.settings.set(RAIL_TOPIC, { sampleInterval: 0.01, batch: { maxSamples: 50, maxInterval: 2 } });
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    expect(streams(h)).toEqual([{ sampleInterval: 0.01, batch: { maxSamples: 50, maxInterval: 2 } }]);
    h.hub.dispose();
  });

  it("asks only for the plotted fields, ignoring the header panels always add", () => {
    const h = harness(aboutWithFields(["a", "b", "c"]));
    h.hub.setWanted(new Map([[RAIL_TOPIC, [["header", "a"], ["c"]]]]));
    expect(streams(h)).toEqual([{ sampleInterval: 0.25, contents: { a: true, c: true } }]);
    h.hub.dispose();
  });

  it("asks for everything when a panel wants whole messages", () => {
    const h = harness(aboutWithFields(["a", "b", "c"]));
    h.hub.setWanted(new Map([[RAIL_TOPIC, [["a"], undefined]]]));
    expect(streams(h)).toEqual([{ sampleInterval: 0.25 }]);
    h.hub.dispose();
  });

  it("picks up a Channel that appears after it was wanted", async () => {
    const h = harness(undefined, { announce: false });
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    expect(h.published).toEqual([]);

    h.observer.handleMessage(`${SVC}/@/Status`, { lynxType: "Service", connected: true }, { retain: true });
    h.observer.handleMessage(`${SVC}/@/About`, clone(fixtures.slicesCore as Rec));
    await h.settle();
    expect(streams(h)).toHaveLength(1);
    h.hub.dispose();
  });

  it("does not start a Stream on a component that is not connected, and says so", async () => {
    const h = harness();
    h.serviceDown();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(streams(h)).toEqual([]);
    expect([...h.problems.values()].map((p) => p.message)).toEqual([expect.stringContaining("not connected")]);
    expect(h.hub.runtime(RAIL_TOPIC).componentDown).toBe(true);

    h.serviceUp();
    await h.settle();
    expect(streams(h)).toHaveLength(1);
    expect(h.problems.size).toBe(0);
    h.hub.dispose();
  });

  it("does not send a second request while the first is unanswered, and retries after the timeout", async () => {
    const h = harness();
    // A Service that never reports the Stream running.
    const original = h.observer;
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    // Undo the simulated Service's announcement: pretend the About has not caught up yet.
    original.handleMessage(`${SVC}/@/About`, { channels: { [RAIL]: { status: { command: null } } } });
    await h.settle();
    expect(streams(h)).toHaveLength(1);
    expect(h.hub.runtime(RAIL_TOPIC).starting).toBe(true);

    h.clock.now += 3500;
    await jest.advanceTimersByTimeAsync(3600);
    expect(streams(h)).toHaveLength(2);
    h.hub.dispose();
  });
});

describe("LynxChannelHub: sharing", () => {
  it("shares a Stream another consumer started and sends nothing", async () => {
    const h = harness();
    h.otherStarts({ sampleInterval: 2 });
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(h.published).toEqual([]);
    expect(h.subscribed).toEqual([RAIL_TOPIC]);
    const runtime = h.hub.runtime(RAIL_TOPIC);
    expect(runtime.ownership).toBe("shared");
    expect(runtime.running).toEqual({ sampleInterval: 2 });
    expect([...h.problems.values()]).toEqual([
      expect.objectContaining({ severity: "info", message: expect.stringContaining("sharing a Stream") }),
    ]);
    h.hub.dispose();
  });

  it("never stops a Stream it did not start when the Channel is no longer wanted", async () => {
    const h = harness();
    h.otherStarts({});
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    h.hub.setWanted(new Map());
    await h.settle();
    expect(stops(h)).toBe(0);
    expect(h.unsubscribed).toEqual([RAIL_TOPIC]);
    expect(h.command()).not.toBeNull();
    expect(h.problems.size).toBe(0);
    h.hub.dispose();
  });

  it("stops the Stream it started when the Channel is no longer wanted", async () => {
    const h = harness();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(h.hub.runtime(RAIL_TOPIC).ownership).toBe("own");
    h.hub.setWanted(new Map());
    expect(stops(h)).toBe(1);
    expect(h.command()).toBeNull();
    h.hub.dispose();
  });

  it("takes over when a shared Stream ends while data is still wanted", async () => {
    const h = harness();
    h.otherStarts({ sampleInterval: 2 });
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(streams(h)).toEqual([]);

    h.ends();
    await h.settle();
    expect(streams(h)).toEqual([{ sampleInterval: 0.25 }]);
    expect(h.hub.runtime(RAIL_TOPIC).ownership).toBe("own");
    h.hub.dispose();
  });

  it("warns when the shared Stream leaves out a field a panel plots", async () => {
    const h = harness(aboutWithFields(["a", "b", "c"]));
    h.otherStarts({ contents: { a: true } });
    h.hub.setWanted(new Map([[RAIL_TOPIC, [["a", "b"]]]]));
    await h.settle();
    const warning = [...h.problems.values()].find((p) => p.severity === "warn");
    expect(warning?.message).toContain("does not include b");
    h.hub.dispose();
  });

  it("does not warn when the shared Stream covers what is plotted", async () => {
    const h = harness(aboutWithFields(["a", "b", "c"]));
    h.otherStarts({ contents: { a: true, b: true } });
    h.hub.setWanted(new Map([[RAIL_TOPIC, [["a", "b"]]]]));
    await h.settle();
    expect([...h.problems.values()].some((p) => p.severity === "warn")).toBe(false);
    h.hub.dispose();
  });

  it("reports a Channel that is busy with something other than a Stream", async () => {
    const h = harness();
    h.observer.handleMessage(`${SVC}/@/About`, { channels: { [RAIL]: { status: { command: { command: "Calibrate", payload: {} } } } } });
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(streams(h)).toEqual([]);
    expect([...h.problems.values()][0]?.message).toContain("busy with Calibrate");
    h.hub.dispose();
  });
});

describe("LynxChannelHub: changing what is streaming", () => {
  it("restarts its own Stream when the user changes the settings", async () => {
    const h = harness();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(streams(h)).toEqual([{ sampleInterval: 0.25 }]);

    h.settings.set(RAIL_TOPIC, { sampleInterval: 0.05, batch: { maxSamples: 10 } });
    await h.settle();
    expect(stops(h)).toBe(1);
    expect(streams(h)).toEqual([{ sampleInterval: 0.25 }, { sampleInterval: 0.05, batch: { maxSamples: 10 } }]);
    expect(h.command()).toEqual({ command: "Stream", payload: { sampleInterval: 0.05, batch: { maxSamples: 10 } } });
    h.hub.dispose();
  });

  it("does not restart when the settings are unchanged", async () => {
    const h = harness();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    h.settings.set(RAIL_TOPIC, { sampleInterval: 0.25 }); // the default: same request
    await h.settle();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(stops(h)).toBe(0);
    expect(streams(h)).toHaveLength(1);
    h.hub.dispose();
  });

  it("restarts its own Stream when a panel starts plotting another field", async () => {
    const h = harness(aboutWithFields(["a", "b", "c"]));
    h.hub.setWanted(new Map([[RAIL_TOPIC, [["a"]]]]));
    await h.settle();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [["a"], ["b"]]]]));
    await h.settle();
    expect(streams(h)).toEqual([
      { sampleInterval: 0.25, contents: { a: true } },
      { sampleInterval: 0.25, contents: { a: true, b: true } },
    ]);
    h.hub.dispose();
  });

  it("does not touch a shared Stream when the settings change", async () => {
    const h = harness();
    h.otherStarts({ sampleInterval: 2 });
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    h.settings.set(RAIL_TOPIC, { sampleInterval: 0.05 });
    await h.settle();
    expect(h.published).toEqual([]);
    h.hub.dispose();
  });

  it("replaces a shared Stream on an explicit restart", async () => {
    const h = harness();
    h.otherStarts({ sampleInterval: 2 });
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    h.settings.set(RAIL_TOPIC, { sampleInterval: 0.1 });

    const done = h.hub.restart(RAIL_TOPIC);
    await jest.advanceTimersByTimeAsync(100);
    await done;
    expect(stops(h)).toBe(1);
    expect(streams(h)).toEqual([{ sampleInterval: 0.1 }]);
    expect(h.hub.runtime(RAIL_TOPIC).ownership).toBe("own");
    h.hub.dispose();
  });

  it("stops any Stream on request and keeps it stopped until the Channel is let go of", async () => {
    const h = harness();
    h.otherStarts({});
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();

    h.hub.stop(RAIL_TOPIC);
    await h.settle();
    expect(stops(h)).toBe(1);
    expect(h.hub.runtime(RAIL_TOPIC)).toMatchObject({ paused: true, ownership: "idle" });
    // It must not start again by itself, however often the network changes.
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(streams(h)).toEqual([]);

    // Letting go, then wanting it again, is a fresh start.
    h.hub.setWanted(new Map());
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(streams(h)).toHaveLength(1);
    h.hub.dispose();
  });

  it("starts again on request after the user stopped it", async () => {
    const h = harness();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    h.hub.stop(RAIL_TOPIC);
    await h.settle();
    expect(streams(h)).toHaveLength(1);
    expect(h.hub.runtime(RAIL_TOPIC).paused).toBe(true);

    h.hub.start(RAIL_TOPIC);
    await h.settle();
    expect(h.hub.runtime(RAIL_TOPIC).paused).toBe(false);
    expect(streams(h)).toHaveLength(2);
    h.hub.dispose();
  });

  it("starts a Stream on request for a Channel no panel plots", async () => {
    const h = harness();
    h.hub.start(RAIL_TOPIC);
    await h.settle();
    expect(streams(h)).toEqual([{ sampleInterval: 0.25 }]);
    expect(h.hub.runtime(RAIL_TOPIC).wanted).toBe(true);

    h.hub.stop(RAIL_TOPIC);
    await h.settle();
    expect(h.hub.runtime(RAIL_TOPIC).wanted).toBe(false);
    expect(h.command()).toBeNull();
    h.hub.dispose();
  });

  it("stops a Stream on request even for a Channel it is not tracking", () => {
    const h = harness();
    h.otherStarts({});
    h.hub.stop(RAIL_TOPIC);
    expect(stops(h)).toBe(1);
    h.hub.dispose();
  });
});

describe("LynxChannelHub: data", () => {
  it("delivers samples with absolute times to listeners, with the Channel they came from", async () => {
    const h = harness();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    h.hub.handleMessage(RAIL_TOPIC, [{ s: 1, ns: 0, data: { rail5v: 5.02 } }], { sec: 1_790_000_001, nsec: 0 });
    expect(h.batches).toHaveLength(1);
    expect(h.batches[0]!.channel.key).toBe(RAIL);
    // The publisher's clock is unix time, so its timestamp fixes the Stream's origin.
    expect(h.batches[0]!.batch.samples[0]).toMatchObject({ time: { s: 1_790_000_001, ns: 0 }, data: { rail5v: 5.02 } });
    expect(h.batches[0]!.batch.timeBasis).toBe("publisher");
    h.hub.dispose();
  });

  it("ignores data for a Channel nobody wants", () => {
    const h = harness();
    h.hub.handleMessage(RAIL_TOPIC, [{ s: 1, ns: 0, data: { rail5v: 5 } }], { sec: 1, nsec: 0 });
    expect(h.batches).toEqual([]);
    h.hub.dispose();
  });

  it("polls a wanted Channel and reports failure for one that is not", async () => {
    const h = harness();
    expect(h.hub.poll(RAIL_TOPIC)).toBe(false);
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(h.hub.poll(RAIL_TOPIC)).toBe(true);
    expect(h.published.at(-1)?.topic).toBe(`${SVC}/${RAIL}/!/Poll`);
    h.hub.dispose();
  });
});

describe("LynxChannelHub: lifecycle", () => {
  it("drops the entry when the Channel disappears from the network and recovers when it returns", async () => {
    const h = harness();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    expect(streams(h)).toHaveLength(1);

    h.removeChannel();
    await h.settle();
    expect(h.network.channelByDataTopic(RAIL_TOPIC)).toBeUndefined();
    expect(h.hub.runtime(RAIL_TOPIC).ownership).toBe("idle");

    h.observer.handleMessage(`${SVC}/@/About`, { channels: clone((fixtures.slicesCore as Rec).channels), replace: [["channels"]] });
    await h.settle();
    expect(h.network.channelByDataTopic(RAIL_TOPIC)).toBeDefined();
    h.hub.dispose();
  });

  it("follows a change in the Channel's endpoints", async () => {
    const h = harness();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    h.hub.stop(RAIL_TOPIC);
    h.hub.start(RAIL_TOPIC);
    await h.settle();
    expect(streams(h)).toHaveLength(2);

    // The Service stops offering Stream on this Channel (interface mutability, A3.0 section 15).
    const trimmed = clone(fixtures.slicesCore as Rec);
    const channel = (trimmed.channels as Record<string, Rec>)[RAIL]!;
    delete (channel.endpoints as Rec)[STREAM];
    delete (channel.endpoints as Rec)[STOP];
    h.ends();
    h.observer.handleMessage(`${SVC}/@/About`, { channels: clone(trimmed.channels), replace: [["channels"]] });
    await h.settle();
    const count = streams(h).length;
    h.hub.refresh();
    await h.settle();
    expect(streams(h)).toHaveLength(count);
    expect([...h.problems.values()].map((p) => p.message)).toEqual([expect.stringContaining("cannot stream")]);
    h.hub.dispose();
  });

  it("notifies state subscribers only when a runtime changed", async () => {
    const h = harness();
    let calls = 0;
    h.hub.subscribe(() => void calls++);
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    await h.settle();
    const after = calls;
    expect(after).toBeGreaterThan(0);
    const version = h.hub.getVersion();
    h.hub.refresh();
    h.hub.refresh();
    expect(calls).toBe(after);
    expect(h.hub.getVersion()).toBe(version);
    h.hub.dispose();
  });

  it("does not stream two Channels through one another's state", async () => {
    const h = harness();
    h.hub.setWanted(
      new Map([
        [RAIL_TOPIC, [undefined]],
        [LED_TOPIC, [undefined]],
      ]),
    );
    await h.settle();
    expect(h.subscribed.sort()).toEqual([LED_TOPIC, RAIL_TOPIC].sort());
    expect(h.published.filter((m) => m.topic.endsWith("!/Stream")).map((m) => m.topic).sort()).toEqual(
      [`${SVC}/${LED}/!/Stream`, STREAM].sort(),
    );
    h.hub.dispose();
  });

  it("stops reacting after dispose", async () => {
    const h = harness();
    h.hub.dispose();
    h.hub.setWanted(new Map([[RAIL_TOPIC, [undefined]]]));
    h.hub.refresh();
    expect(h.published).toEqual([]);
  });
});

describe("describeRequest", () => {
  it("summarizes a request for a message", () => {
    expect(describeRequest({})).toBe("every 1 s");
    expect(describeRequest({ sampleInterval: 0.1, batch: { maxSamples: 5, maxInterval: 2 }, contents: { a: true, b: true } })).toBe(
      "every 0.1 s, 5 per message, flush 2 s, fields a, b",
    );
  });
});
