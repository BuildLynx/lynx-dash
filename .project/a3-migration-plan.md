# Lynx Dash: migration to Lynx A3.0

**Status (2026-09-30): phases 0–5 implemented and verified against the live broker; uncommitted in both repos.**
Phases 6 (Playwright e2e in the repo) and 7 (Docker/deploy) are not done. Plan written 2026-09-29.

### Progress log

- **Phase 0:** yarn 3.6.3 works through corepack (`.yarn/cache` is enough offline). Baseline: Lynx jest 4/4, `suite-base` type-check clean.
- **Phase 1 (SDK, `lynx-sdk-typescript`, uncommitted):** `ChannelClient`, `StreamTimeline` (stream-start time base), `Buffer.from` removed from the Last Will. 973 tests with broker + independent Node, 11 mutations caught. Also fixed a flaky interop test helper. Details in the SDK's `A3-MIGRATION-PLAN.md`.
- **Phase 2:** `packages/suite-base/package.json` now uses `portal:../../../../lynx-sdk-typescript` (a live junction); the old frozen copy is gone. `jest.config.json` maps `lynx-sdk-typescript` to its built `dist/index.js` (the SDK is ESM-only).
- **Phase 3:** deleted `LynxMqttManager`, `LynxNetworkState`, `LynxServiceIdentity`. New: `LynxSession` (two connections: the SDK `Service` for the dash's own presence, and a `LynxObserver` connection for everything else), `LynxNetwork` (snapshot over the SDK `Observer`), `lynxIdentity` (per-tab name in `sessionStorage`, Web Lock so a duplicated tab takes a new name), `LynxChannelHub` (streams; implements decision 2), `LynxStreamSettings` (per-Channel settings, defaults, `contents` derivation).
- **Phase 4:** `LynxPlayer` reworked (topics from endpoint metadata, hub batches with absolute times clamped to now, alerts from hub problems and Notices). Schema converter now handles `["number","null"]` and other type lists; it previously dropped every field of every real Channel.
- **Phase 5:** Network sidebar (deployed names, connected/down/stale/loading, `[unsupported]` rows, refresh via `reconcile`), Channel detail with a schema-driven **Stream settings** form (only the settings that Channel's `!/Stream` schema lists), Messages sidebar on re-rooted endpoint topics, Plot utilities on the snapshot. Other dash instances are hidden while down (closed tabs leave a retained "down" record).
- **Verified live (headless Edge against `ws://localhost:9001`):** 15 `slicesCore` Channels and the Node listed, `LynxBucket` shown as unsupported; Start stream from the UI sent `{sampleInterval:0.25}`, the Service announced `status.command`, the row showed streaming, data arrived, Stop returned it to idle; a Raw Messages panel on a Channel topic auto-started a stream and showed real values with real unix receive times.
- **Tests:** 112 in `src/lynx` (network view incl. real captured Abouts in `__fixtures__/live-about.json`, hub sharing/take-over/restart/pause, settings, form, identity, converter). Hub, settings, network and SDK code were mutation-tested.

### Phases 6-7 (2026-09-30)

- **Phase 6:** `e2e/tests/web/lynx.web.spec.ts` (opt-in: `LYNX_E2E_BROKER=ws://... yarn test:e2e:web`, optional `LYNX_E2E_CHANNEL`, `LYNX_E2E_URL`). Lints clean. **Not yet run**: the broker went quiet (see below), and the repo's e2e config starts its own server on 8080, which the existing `lynx-dash-app` container occupies.
- **Phase 7:** the Dockerfile now builds the SDK in the image (`npm ci && npm run build`) instead of copying whatever `dist/` is on disk, and `Dockerfile.dockerignore` skips the SDK's `.venv`, `.git` and `dist`. A test build (`docker build -t lynx-dash:a3-test`) got through `yarn install` and the SDK build and into the webpack production step, then the Docker engine crashed and restarted every container. **The image has not been built to completion.** Do not retry unattended.

### Known gaps and follow-ups

- Not run yet: Playwright e2e in the repo; Docker build (the SDK is outside the repo, so `portal:` needs it in the build context, same as the old `file:`); `wss` deployments.
- Not checked visually: dark/light theme, narrow sidebar, the Lynx Plot panel with nullable values (gaps for `null`).
- A second `!/Stop` is sent when a stream the dash started is stopped explicitly (harmless).
- Pre-existing eslint errors remain in files carried over from the fork (`LynxPlot.tsx`, `LynxPlayer.ts` patterns, `jsonSchemaToMessageDefinition.ts`, `SchemaForm`, `JsonPayloadEditor`); none were introduced here.
- A tab that is force-killed still leaves a retained down record until someone clears it; it is hidden in the UI but stays on the broker.
- Reply-topic pre-filling in the Messages sidebar (`replyTopics`/`dataOutput`) is not done.

(Original plan follows.)
**Protocol:** `D:\3X__STEM\31__Software\2026-01_Lynx\lynx-protocol.md` (A3.0).
**SDK:** `D:\3X__STEM\31__Software\2026-01_Lynx\lynx-sdk-typescript` (A3.0; see its `A3-MIGRATION-PLAN.md` and README).

## 1. What Lynx Dash is

A **fork of Lichtblick 1.25.1** (yarn 3 workspaces, React, webpack, MUI) with the Lynx integration committed on top in
seven commits (2026-06-01 to 2026-08-12), about 5,500 lines in 35 files under `packages/suite-base/src/`:

| Piece | Files |
|---|---|
| State and protocol layer | `lynx/` (`types.ts`, `LynxNetworkState.ts`, `LynxMqttManager.ts`, `LynxServiceIdentity.ts`, `lynxConf.ts`, `lynxRuntimeStore.ts`, `jsonSchemaToMessageDefinition.ts`, `lynxMessagesNavigation.ts`) |
| Data source | `dataSources/LynxDataSourceFactory.ts`, `players/LynxPlayer/LynxPlayer.ts` |
| Network sidebar | `components/LynxNetworkSidebar/*` |
| Messages sidebar | `components/LynxMessagesSidebar/*` |
| Plot panel | `panels/LynxPlot/*` |
| Shell edits | `Workspace.tsx`, `StudioApp.tsx`, `Autocomplete`, `MessagePathSyntax`, `message-path` grammar, `WorkspaceContext` |

How it works today: `LynxPlayer` implements Lichtblick's `Player`. Each Lynx Channel becomes a topic named
`{service}/{channel}/<`; the Channel's JSON Schema from its About becomes a Lichtblick message definition; each sample
becomes a `MessageEvent`. A stream is started for every subscribed topic and stopped when it is unsubscribed. The dash
also registers itself on the network as a Service.

The dash's `node_modules/lynx-sdk-typescript` is a **frozen copy from 2026-06-01** (a yarn `file:` copy, with its own
`.git`, reporting `A-01.01` and the pre-restructure `models/`/`utils/` layout). The dash works today only because it is
insulated from every A3 change. Refreshing that dependency breaks it.

## 2. Decisions (made 2026-09-29)

1. **Identity per tab.** The dash's deployed name is generated per browser tab, stored in `sessionStorage` (not
   `localStorage`, which two tabs would share, colliding on one Status topic). The "Lynx Service ID" field on the
   connection form becomes an optional deployment name.
2. **Streams are shared, and their settings belong to each Channel.**
   - If a Channel is already streaming (`status.command` is a Stream), the dash subscribes and shares it. It never stops
     a stream it did not start.
   - Stream rate and batching are settable **per Channel** in the dash. This is core to Lynx: they are the Stream request
     (`sampleInterval`, `batch.maxInterval`, `batch.maxSamples`, `numSamples`, `contents`), and today the dash hard-codes
     them (`interval: 0.25`, `paginate: 1` in `LynxMqttManager.startStream`). See section 6.
3. **Pre-A3 components show as unsupported.** They are not shimmed. This matches what the independent Lynx Node does
   (it does not list `LynxBucket`).
4. **Running `corepack yarn install` is approved** (it may download yarn 3.6.3). This is step 0 below; nothing has been
   run yet.

Also assumed: the direction is to keep the Lichtblick fork and migrate the Lynx layer.

## 3. Why it breaks against A3.0

Found by reading the Lynx code and searching it for old-protocol fields.

- **Removed SDK code:** `LynxNetworkState.ts` imports `NetworkState`, which the SDK removed.
- **Old field names throughout:** `docs.id` / `docs.title` / `docs.description` / `docs.lynx_version`; `status.state`
  (idle, busy, disconnected, disabled); `status.action`; `child_nodes`. A3 has `component` and `config.deployment`,
  `status.connected` (Service, Node) and `status.command` (Channel), and `childNodes`.
- **Presence and About:**
  - The Last Will is on a retained `@/About` (`LynxMqttManager.connect`). A3: retained `@/Status`.
  - The dash publishes a retained About (`LynxServiceIdentity`). A3: About is not retained.
  - It subscribes to per-Channel `+/+/@/About` (`LYNX_CHANNEL_ABOUT_MONITOR_TOPIC`). A3 has no per-Channel About; Channels
    are inside the Service's About.
  - It dims components using `status.state`; A3 liveness is the retained Status.
- **Stream commands:** it sends `{contents, interval, numSamples, paginate}`. A3 Channels reject `interval` and
  `paginate` (the schema forbids extra fields), so no stream would start. The A3 fields are `sampleInterval` and
  `batch.{maxInterval, maxSamples}`.
- **Timestamps (bug):** `LynxPlayer.sampleToReceiveTime` sets `receiveTime = publishTime + sample.s/ns`. That was right
  when `s`/`ns` were relative to the batch. In A3 they are relative to the **stream start**, so after an hour every
  sample is dated an hour into the future.
- **Topic construction from ids:** topics are built as `{serviceId}/{channelId}/<` from the `channels` map **key**
  (`channelOutputTopic`, `channelStreamTopic`, `channelStopTopic`, `startStream`, `poll`). In A3 the topic segment is the
  Channel's deployed name, `config.deployment.name`, which can differ from the key. The correct topics are the endpoint
  keys in the About (complete topics in the component's local frame), re-rooted by the arrival path.
- **Refresh actions:** `useLynxNetworkActions` publishes to a bare `?/About` topic. That means nothing in A3; refresh is
  per component (`?/About`, or Sync).
- **Version strings:** `LYNX_PROTOCOL_VERSION = "A-01.01"` and hard-coded `lynx_version: "A-01.01"` in several places.

## 4. What real data looks like (checked on the live broker)

Components on the local broker (1883 MQTT, 9001 WebSocket), useful for development and end-to-end tests:

| Component | What it is |
|---|---|
| `lynxNode-e35ae243` | An independent A3.0 Node. Passes the SDK's interop tests. |
| `slicesCore-46534b98` | An A3 Service with **15 Channels**. No `?/Sync` and no `@/Sync`. Carries `generation` inside its About. |
| `LynxBucket` | A pre-A3 Service (`docs`/`id`, no Status). |

What this means for the dash:
- **Channels do not stream until commanded.** With no command, zero data messages arrive. The dash must start streams.
- **Data schemas are thin.** For example `{"type":"object","additionalProperties":false,"required":["rail5v"],
  "properties":{"rail5v":{"type":["number","null"],"description":"In V."}}}`. There is no `minimum`, `maximum` or `unit`;
  the unit is prose in `description`. Values can be `null` ("out of range"). The schema converter must handle type
  arrays containing `"null"`, and plots must show gaps for `null`.
- **Stream requests accept** `contents, sampleInterval, numSamples, batch` on every Channel seen.
- **`slicesCore` has no Sync**, so it can only be refreshed with a full `?/About`.

## 5. Target architecture

Keep the Lichtblick shell, panels, and Player interface. Replace the hand-rolled protocol layer with the SDK:

```
MQTT broker (ws://...)
   |
   +-- LynxMqttManager (one shared connection, message routing)         [kept, slimmed]
   |      |-- SDK Observer   roster (retained Status), About cache,      [replaces LynxNetworkState]
   |      |                  staleness, reconcile, Notices
   |      |-- SDK Service    the dash's own identity (Status, Will,      [replaces LynxServiceIdentity]
   |      |                  About, Sync, Notice), per-tab name
   |      `-- SDK ChannelClient   start/stop stream, poll, batch ->      [new, added to the SDK]
   |                             timestamped samples, sharing
   |
   +-- LynxNetwork (view model over the Observer)                        [new]
   |      tree from Node aggregates + roster; Channels with complete
   |      topics, effective titles, schemas, live status, staleness
   |
   `-- LynxPlayer -> Lichtblick panels, sidebars                         [reworked]
```

One question to settle while building: the SDK's `Service` and `Observer` each want the MQTT connection. The simplest
approach is two connections per tab (the observer anonymous, with no Will; the Service with Status and Will). If that
proves undesirable, the SDK can offer a Service that also observes.

## 6. Stream settings per Channel (core feature)

The Stream request is the heart of consuming a Channel, and the A3 schema advertises which fields each Channel accepts.

- **Where:** the Channel detail panel in the Network sidebar gets a "Stream settings" section.
- **What:** generated from the Channel's own `!/Stream` `payload_schema` (rjsf is already a dependency and already used
  by `SendSection`), so only fields the Channel advertises are shown: `sampleInterval`, `batch.maxInterval`,
  `batch.maxSamples`, `numSamples`, `contents`.
- **`contents`:** derived automatically from the fields the panels actually plot, so a panel asks only for what it draws,
  with an override. (To verify: whether Lichtblick's subscription payload carries per-field information to derive it from.)
- **Defaults:** replace the hard-coded `interval: 0.25`, `paginate: 1`. Batching should default sensibly for higher rates
  (for example, batch a fraction of a second of samples) rather than one message per sample.
- **Persistence:** remembered per Channel topic, per browser, initially (to decide: whether it should also travel with an
  exported layout).
- **Sharing (decision 2):** when a Channel is already streaming, show the running request (`status.command.payload`)
  read-only, subscribe to it, and never stop it. Offer an explicit "stop and restart with my settings" action. Warn when the
  running stream cannot satisfy a panel (for example its `contents` omits a plotted field, or its rate is slower than
  requested). A Channel runs one command at a time, so a refused start is reported (it arrives as a Notice), not retried
  silently.
- **Stopping:** only streams the dash started are stopped, when the last subscriber to that topic goes away or the
  player closes.
- **Poll** stays available from the Messages sidebar.

## 7. SDK additions (in `lynx-sdk-typescript`, with tests, committed separately)

1. **`ChannelClient`** (consumer side):
   - `subscribe(topic)`, `startStream(request)`, `stop()`, `poll(contents)`;
   - report `status.command` (idle, or someone else's stream) so callers can share;
   - decode batches into samples with **absolute times**.
2. **Stream time base.** Sample `s`/`ns` are relative to the stream start and the stream start is not sent. Estimate the
   origin per stream as the minimum over received batches of `(MQTT publish time - last sample offset)` (publication only
   adds delay, so the minimum converges on the true origin). Reset it when offsets go backwards (a restarted stream). If the
   publisher's `component.time_source` is not `unix`, publish times are not wall-clock: fall back to receive time and mark the
   samples accordingly. Optionally refine the origin from the About announcement that sets `status.command`.
3. **Remove `Buffer.from`** from the Last Will in `ClientComponent.lastWill` (mqtt accepts a string). Lichtblick's webpack
   polyfills `Buffer`, but other bundlers would fail.
4. Anything else the reworked Player needs that the Observer does not expose (for example, message timestamps on
   announcements).

## 8. Migration map (old -> new)

| Old | Change |
|---|---|
| `lynx/types.ts` | Delete the A-01.01 types. Use the SDK's types; keep thin view types only. |
| `lynx/LynxNetworkState.ts` | Delete. Replaced by `LynxNetwork`, a view over the SDK `Observer`. |
| `lynx/LynxServiceIdentity.ts` | Delete. Replaced by the SDK `Service` with a `sessionStorage` deployment store. |
| `lynx/LynxMqttManager.ts` | Keep connection and routing. Remove the Will (the Service owns it), the `+/@/About` and `+/+/@/About` subscriptions, and `startStream`/`poll`/`stopStream` (moved to `ChannelClient`). |
| `lynx/jsonSchemaToMessageDefinition.ts` | Find the `<` schema by the endpoint's own topic, not `{service}/{channelId}/<`. Support type arrays with `"null"`, `$schema`, `required`, `description`. Update its test (it uses an A-01.01 fixture). |
| `lynx/lynxConf.ts` | Keep. |
| `lynx/lynxRuntimeStore.ts` | Hold the new objects (network, channel client, service). |
| `players/LynxPlayer/LynxPlayer.ts` | Rework: topics from endpoint metadata; streams through `ChannelClient` with the corrected time base; sharing; Channels appearing and disappearing while connected; down or stale components; Notices as player alerts. |
| `dataSources/LynxDataSourceFactory.ts` | "Lynx Service ID" becomes an optional deployment name. Update the description (About is not retained; discovery is from Status). |
| `components/LynxNetworkSidebar/*` | Tree from Node aggregates and the roster. Show deployed name, title, connected / stale / unsupported, `generation`, `notice_level`. Refresh becomes `observer.reconcile`. Stream settings (section 6). |
| `components/LynxMessagesSidebar/*` | Use re-rooted endpoint topics. Pre-fill Receive from `replyTopics` and `dataOutput`. Show the A3 endpoints (`@/Status`, `?/Sync`, `@/Sync`, `@/Notice`). |
| `panels/LynxPlot/*` | Titles and labels from the effective metadata. Use schema ranges for scaling when present, and fall back to data range. |

## 9. Phases

| # | Work | Verified by |
|---|---|---|
| 0 | Get `corepack yarn` working, install from the offline cache, and run the existing Lynx jest test. | The test passes; the web build starts. |
| 1 | SDK: `ChannelClient`, stream time base, remove `Buffer.from`. Unit, fake-broker, and live-broker tests. | SDK tests; timestamps checked against a live stream. |
| 2 | Repoint the dash at the live SDK (`portal:`, so a rebuilt SDK is not silently ignored). Fix the compile errors. | The dash type-checks and builds. |
| 3 | Replace `src/lynx/` with `LynxNetwork`, the SDK `Service`, and `ChannelClient`. | Unit tests with fixtures captured from `slicesCore` and the Lynx Node. |
| 4 | Rework `LynxPlayer` and the schema converter. | Jest tests; a Player test against a fake broker. |
| 5 | Network sidebar, Messages sidebar, Plot, stream settings. | Component tests; a visual check in the browser against `slicesCore`. |
| 6 | End-to-end (Playwright, `e2e/tests/web`) against the local broker: discovery, streaming a real Channel, changing stream settings, sharing an existing stream, a component going down, an unsupported component. | The e2e suite. |
| 7 | Deployment: check the Dockerfile and compose, the `lynxConf.json` path, and `wss` when served over https. | A container run against the local broker. |

## 10. Testing

- **Fixtures from the real network:** capture the live About of `slicesCore` and the Lynx Node into test fixtures (the SDK
  repo does the same in `tests/fixtures/`).
- **Schema converter:** run against real A3 schemas, including `["number","null"]`.
- **Time base:** unit tests with synthetic batches (including a restarted stream and a non-unix time source), plus a live
  check that plotted times agree with wall-clock.
- **Fake broker:** the SDK repo's `tests/helpers/fake-broker.ts` can be reused or copied for Player tests.
- **e2e:** the live broker with `slicesCore` (15 Channels of real data) and the Lynx Node.

## 11. Risks

- **Stream contention** between consumers (mitigated by the sharing policy and explicit restart).
- **Absolute time** for sample times, especially with non-unix time sources.
- **Thin schemas:** no ranges or units, so scaling and units rely on data and prose.
- **Data volume:** many Channels at high rates; batching defaults and memory limits (the Player already evicts).
- **Hierarchy depth:** without relaying, a Node only aggregates its direct children; deeper layers need Nodes that relay
  (the Python SDK has this; the TypeScript SDK defers it).
- **Two MQTT connections per tab** (see section 5).
- **Yarn `file:` dependency copies** go stale silently (this is how the dash ended up on an A-01.01 SDK).

## 12. Not yet verified

This plan comes from reading the state layer, player, MQTT manager, identity, data source, and the start of the schema
converter, plus a search of all Lynx files for old-protocol fields. **Not yet read in full:** the Network and Messages
sidebar components, the Lynx Plot panel, and the tail of the schema converter. **Not yet run:** the dash itself (yarn was
not on the PATH). Treat the migration map as accurate for the files read and as a starting list for the rest.

To investigate during the work:
- whether the converter already handles `type` arrays with `"null"`;
- whether Lichtblick subscription payloads carry per-field information (for deriving `contents`);
- how the shell's Lynx Plot panel gets its data, and whether it depends on the removed types.

## 13. Development environment reference

- Live broker: `mqtt://localhost:1883`, `ws://localhost:9001` (inside Docker).
- SDK opt-in tests against the live network:
  `LYNX_TEST_BROKER=mqtt://localhost:1883 LYNX_TEST_NODE=lynxNode-e35ae243 npm test` in `lynx-sdk-typescript`.
- SDK examples: `src/examples/observer.ts` and `src/examples/node.ts` show the observer and Node APIs.
- `Services/deploy.sh` and the dash's `Dockerfile` / `docker-compose.yml` handle deployment.
