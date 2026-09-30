// SPDX-License-Identifier: MPL-2.0

import { Observer } from "lynx-sdk-typescript";

import { LynxNetwork } from "@lichtblick/suite-base/lynx/LynxNetwork";

import fixtures from "./__fixtures__/live-about.json";

type Rec = Record<string, unknown>;

const SVC = "slicesCore-46534b98";
const NODE = "lynxNode-e35ae243";
const LYNX_CH = "441BF6D79ADC-lynx";
const RAIL_CH = "441BF6D79ADC-rail5v";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value) ?? "null") as T;
}

function makeObserver(options: Partial<ConstructorParameters<typeof Observer>[0]> = {}) {
  const sent: Array<{ topic: string; payload: Rec }> = [];
  const observer = new Observer({
    send: (topic, payload) => sent.push({ topic, payload }),
    logger: { error() {} },
    ...options,
  });
  return { observer, sent };
}

/** Announce `path` on the broker: its retained Status, then its full About. */
function announce(observer: Observer, path: string, about: Rec): void {
  observer.handleMessage(`${path}/@/Status`, { lynxType: about.lynxType, connected: true }, { retain: true });
  observer.handleMessage(`${path}/@/About`, clone(about));
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 80));
};

describe("LynxNetwork", () => {
  it("builds component and Channel views from an observed Service", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, SVC, fixtures.slicesCore as Rec);

    const snapshot = network.snapshot();
    expect(snapshot.roots).toEqual([SVC]);
    const service = snapshot.components[SVC]!;
    expect(service).toMatchObject({
      kind: "service",
      path: SVC,
      name: SVC,
      title: "Bench stack",
      componentName: "slicesCore",
      lynxVersion: "A3.0",
      timeSource: "unix",
      connected: true,
      loading: false,
      noticeLevel: 2,
      supportsSync: false,
    });
    expect(Object.keys(service.channels)).toHaveLength(4);
    network.dispose();
  });

  it("gives a Channel its deployed name, complete topics, schemas, and idle command", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, SVC, fixtures.slicesCore as Rec);

    const channel = network.channel(SVC, RAIL_CH)!;
    expect(channel.key).toBe(RAIL_CH);
    expect(channel.name).toBe(RAIL_CH);
    // The deployment's title wins over the component's ("5 V rail"), as does its empty description.
    expect(channel.title).toBe("Core: 5 V rail");
    expect(channel.description).toBe("");
    expect(channel.dataTopic).toBe(`${SVC}/${RAIL_CH}/<`);
    expect(channel.base).toBe(`${SVC}/${RAIL_CH}`);
    expect(channel.topics).toEqual({
      data: `${SVC}/${RAIL_CH}/<`,
      stream: `${SVC}/${RAIL_CH}/!/Stream`,
      stop: `${SVC}/${RAIL_CH}/!/Stop`,
      poll: `${SVC}/${RAIL_CH}/!/Poll`,
    });
    expect(channel.command).toBeNull();
    expect(channel.payloadSchema).toMatchObject({ type: "array" });
    // The Stream schema is what says which stream settings the Channel accepts.
    const props = (channel.streamRequestSchema as Rec).properties as Rec;
    expect(Object.keys(props).sort()).toEqual(["batch", "contents", "numSamples", "sampleInterval"]);
    network.dispose();
  });

  it("falls back to the component's title, and to the name when there is none", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    const about = clone(fixtures.slicesCore as Rec);
    const channels = about.channels as Record<string, Rec>;
    delete (channels[RAIL_CH]!.config as Rec & { deployment: Rec }).deployment.title;
    channels[LYNX_CH]!.component = { ...(channels[LYNX_CH]!.component as Rec), title: "" };
    delete (channels[LYNX_CH]!.config as Rec & { deployment: Rec }).deployment.title;
    announce(observer, SVC, about);
    expect(network.channel(SVC, RAIL_CH)!.title).toBe("5 V rail");
    expect(network.channel(SVC, LYNX_CH)!.title).toBe(LYNX_CH);
    network.dispose();
  });

  it("finds a Channel by its data topic", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, SVC, fixtures.slicesCore as Rec);
    expect(network.channelByDataTopic(`${SVC}/${LYNX_CH}/<`)?.key).toBe(LYNX_CH);
    expect(network.channelByDataTopic("nope/<")).toBeUndefined();
    expect(network.allChannels()).toHaveLength(4);
    network.dispose();
  });

  it("reports a Channel's running command from status.command", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    const about = clone(fixtures.slicesCore as Rec);
    ((about.channels as Rec)[RAIL_CH] as Rec).status = {
      command: { command: "Stream", payload: { sampleInterval: 0.5 } },
    };
    announce(observer, SVC, about);
    expect(network.channel(SVC, RAIL_CH)!.command).toEqual({
      command: "Stream",
      payload: { sampleInterval: 0.5 },
    });
    network.dispose();
  });

  it("follows a status.command announcement", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, SVC, fixtures.slicesCore as Rec);
    expect(network.channel(SVC, RAIL_CH)!.command).toBeNull();

    // A partial announcement changes only status.command (A3.0 section 7).
    observer.handleMessage(`${SVC}/@/About`, {
      channels: { [RAIL_CH]: { status: { command: { command: "Stream", payload: {} } } } },
    });
    expect(network.channel(SVC, RAIL_CH)!.command).toEqual({ command: "Stream", payload: {} });

    observer.handleMessage(`${SVC}/@/About`, { channels: { [RAIL_CH]: { status: { command: null } } } });
    expect(network.channel(SVC, RAIL_CH)!.command).toBeNull();
    network.dispose();
  });

  it("marks a component that went down as not connected and stale", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, SVC, fixtures.slicesCore as Rec);
    observer.handleMessage(`${SVC}/@/Status`, { lynxType: "Service", connected: false }, { retain: true });
    const service = network.component(SVC)!;
    expect(service.connected).toBe(false);
    expect(service.stale).toBe(true);
    // What it described is still known.
    expect(Object.keys(service.channels)).toHaveLength(4);
    network.dispose();
  });

  it("lists another dash only while it is up, since closed tabs leave a retained down record", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    const dash = clone(fixtures.slicesCore as Rec);
    dash.component = { ...(dash.component as Rec), name: "lynxDash" };
    dash.channels = {};
    announce(observer, "lynxDash-aaaaaaaa", dash);
    expect(network.component("lynxDash-aaaaaaaa")).toBeDefined();

    observer.handleMessage("lynxDash-aaaaaaaa/@/Status", { lynxType: "Service", connected: false }, { retain: true });
    expect(network.snapshot().components).toEqual({});
    expect(network.snapshot().roots).toEqual([]);

    // An ordinary component that is down stays listed: its being down is news.
    announce(observer, SVC, fixtures.slicesCore as Rec);
    observer.handleMessage(`${SVC}/@/Status`, { lynxType: "Service", connected: false }, { retain: true });
    expect(network.component(SVC)?.connected).toBe(false);
    network.dispose();
  });

  it("shows a component as loading until its About arrives", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    observer.handleMessage(`${SVC}/@/Status`, { lynxType: "Service", connected: true }, { retain: true });
    const service = network.component(SVC)!;
    expect(service.loading).toBe(true);
    expect(service.connected).toBe(true);
    expect(service.channels).toEqual({});
    network.dispose();
  });

  it("describes a Node and what it lists", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, NODE, fixtures.node as Rec);
    const node = network.component(NODE)!;
    expect(node.kind).toBe("node");
    expect(node.supportsSync).toBe(true);
    expect(node.listedServices).toEqual([SVC]);
    expect(node.listedNodes).toEqual([]);
    network.dispose();
  });

  it("nests components observed beneath a Node and re-roots their topics", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, NODE, fixtures.node as Rec);
    announce(observer, `${NODE}/${SVC}`, fixtures.slicesCore as Rec);

    const snapshot = network.snapshot();
    expect(snapshot.roots).toEqual([NODE]);
    expect(snapshot.childrenOf[NODE]).toEqual([`${NODE}/${SVC}`]);
    const child = snapshot.components[`${NODE}/${SVC}`]!;
    expect(child.parentPath).toBe(NODE);
    // Topics declared in the child's own frame are re-rooted under the Node.
    expect(child.channels[RAIL_CH]!.dataTopic).toBe(`${NODE}/${SVC}/${RAIL_CH}/<`);
    network.dispose();
  });

  it("reports a pre-A3 component as unsupported, once, and drops it when it upgrades", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    observer.handleMessage("LynxBucket/@/About", {
      lynxType: "Service",
      docs: { id: "LynxBucket", title: "Bucket", lynx_version: "A-01.01" },
      status: { state: "idle" },
    });
    expect(network.snapshot().unsupported).toEqual([
      expect.objectContaining({ path: "LynxBucket", reason: expect.stringContaining("pre-A3") }),
    ]);
    expect(network.snapshot().components).toEqual({});

    announce(observer, "LynxBucket", fixtures.slicesCore as Rec);
    expect(network.snapshot().unsupported).toEqual([]);
    expect(network.component("LynxBucket")).toBeDefined();
    network.dispose();
  });

  it("removes a component whose Status was cleared", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, SVC, fixtures.slicesCore as Rec);
    observer.handleMessage(`${SVC}/@/Status`, null, { retain: true, empty: true });
    expect(network.snapshot().components).toEqual({});
    network.dispose();
  });

  it("keeps recent Notices per component and forwards them", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, SVC, fixtures.slicesCore as Rec);
    const seen: string[] = [];
    network.onNotice((n) => seen.push(`${n.path}:${n.severity}:${n.message}`));
    observer.handleMessage(`${SVC}/@/Notice`, {
      action: "Stream",
      severity: 3,
      message: "Channel is already running a command",
      data: {},
    });
    expect(seen).toEqual([`${SVC}:3:Channel is already running a command`]);
    expect(network.recentNotices(SVC)).toHaveLength(1);
    expect(network.recentNotices(SVC)[0]).toMatchObject({ action: "Stream", severity: 3 });
    network.dispose();
  });

  it("forgets a component's Notices when it leaves", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, SVC, fixtures.slicesCore as Rec);
    observer.handleMessage(`${SVC}/@/Notice`, { action: "", severity: 4, message: "boom", data: {} });
    expect(network.recentNotices(SVC)).toHaveLength(1);
    observer.handleMessage(`${SVC}/@/Status`, null, { retain: true, empty: true });
    expect(network.recentNotices(SVC)).toEqual([]);
    network.dispose();
  });

  it("does not resurrect an upgraded component as unsupported after it leaves", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    observer.handleMessage("LynxBucket/@/About", { lynxType: "Service", docs: { id: "LynxBucket" } });
    announce(observer, "LynxBucket", fixtures.slicesCore as Rec);
    observer.handleMessage("LynxBucket/@/Status", null, { retain: true, empty: true });
    expect(network.snapshot().components).toEqual({});
    expect(network.snapshot().unsupported).toEqual([]);
    network.dispose();
  });

  it("ignores Notices from components it does not know", () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    const seen: unknown[] = [];
    network.onNotice((n) => seen.push(n));
    observer.handleMessage("ghost/@/Notice", { action: "", severity: 4, message: "x", data: {} });
    expect(seen).toEqual([]);
    network.dispose();
  });

  it("does not observe components the Observer excludes", () => {
    const { observer, sent } = makeObserver({ include: (path) => path !== "lynxDash-abcd1234" });
    const network = new LynxNetwork(observer);
    announce(observer, "lynxDash-abcd1234", fixtures.slicesCore as Rec);
    expect(network.snapshot().components).toEqual({});
    expect(sent).toEqual([]);
    network.dispose();
  });

  it("notifies subscribers once for a burst of changes, and rebuilds only when something changed", async () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    const versions: number[] = [];
    network.subscribe((s) => versions.push(s.version));

    announce(observer, SVC, fixtures.slicesCore as Rec);
    announce(observer, NODE, fixtures.node as Rec);
    await flush();
    expect(versions).toHaveLength(1);

    const first = network.snapshot();
    expect(network.snapshot()).toBe(first);
    network.dispose();
  });

  it("stops notifying after dispose", async () => {
    const { observer } = makeObserver();
    const network = new LynxNetwork(observer);
    const versions: number[] = [];
    network.subscribe((s) => versions.push(s.version));
    announce(observer, SVC, fixtures.slicesCore as Rec);
    network.dispose();
    await flush();
    expect(versions).toEqual([]);
  });

  it("asks for a full About on reconcile when the component has no Sync", () => {
    const { observer, sent } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, SVC, fixtures.slicesCore as Rec);
    sent.length = 0;
    // slicesCore does not advertise ?/Sync, so no Sync is started; a full About is requested at once.
    expect(network.reconcile(SVC)).toBe(false);
    expect(sent).toEqual([{ topic: `${SVC}/?/About`, payload: {} }]);
    expect(network.component(SVC)!.stale).toBe(true);
    network.dispose();
  });

  it("reconciles with Sync when the component advertises it", () => {
    const { observer, sent } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, NODE, fixtures.node as Rec);
    sent.length = 0;
    expect(network.reconcile(NODE)).toBe(true);
    expect(sent.map((m) => m.topic)).toEqual([`${NODE}/?/Sync`]);
    network.dispose();
  });

  it("reconciles every observed component", () => {
    const { observer, sent } = makeObserver();
    const network = new LynxNetwork(observer);
    announce(observer, NODE, fixtures.node as Rec);
    announce(observer, SVC, fixtures.slicesCore as Rec);
    sent.length = 0;
    network.reconcileAll();
    expect(sent.map((m) => m.topic).sort()).toEqual([`${NODE}/?/Sync`, `${SVC}/?/About`]);
    network.dispose();
  });
});
