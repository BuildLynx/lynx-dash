// SPDX-License-Identifier: MPL-2.0

import { useCallback } from "react";

import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import type { LynxChannelView, LynxNetworkSnapshot } from "@lichtblick/suite-base/lynx/types";

import type { SelectedNetworkItem } from "./LynxNetworkSelectionContext";

function aboutTargetPath(item: SelectedNetworkItem): string | undefined {
  switch (item?.kind) {
    case "component":
    case "unsupported":
      return item.path;
    case "channel":
      return item.servicePath;
    case undefined:
      return undefined;
  }
}

export function channelOf(snapshot: LynxNetworkSnapshot, item: SelectedNetworkItem): LynxChannelView | undefined {
  if (item?.kind !== "channel") {
    return undefined;
  }
  return snapshot.components[item.servicePath]?.channels[item.channelKey];
}

export function useLynxNetworkActions(): {
  /** Catch every component up with what it currently says about itself. */
  refresh: () => void;
  /** Catch one component up (Sync, or a full About when it has no Sync). */
  about: (item: SelectedNetworkItem) => void;
  streamToggle: (item: SelectedNetworkItem) => void;
  poll: (item: SelectedNetworkItem) => void;
  isChannelStreaming: (item: SelectedNetworkItem) => boolean;
} {
  const session = useLynxRuntimeStore((s) => s.session);
  const snapshot = useLynxRuntimeStore((s) => s.network);

  const refresh = useCallback(() => {
    session?.network.reconcileAll();
  }, [session]);

  const about = useCallback(
    (item: SelectedNetworkItem) => {
      const path = aboutTargetPath(item);
      if (path != undefined) {
        session?.network.reconcile(path);
      }
    },
    [session],
  );

  const isChannelStreaming = useCallback(
    (item: SelectedNetworkItem): boolean => {
      const channel = channelOf(snapshot, item);
      return channel?.command?.command === "Stream";
    },
    [snapshot],
  );

  const streamToggle = useCallback(
    (item: SelectedNetworkItem) => {
      const channel = channelOf(snapshot, item);
      if (session == undefined || channel?.dataTopic == undefined) {
        return;
      }
      if (channel.command?.command === "Stream") {
        // The user asked: this stops the Stream even if another consumer started it.
        session.hub.stop(channel.dataTopic);
      } else {
        session.hub.start(channel.dataTopic);
      }
    },
    [session, snapshot],
  );

  const poll = useCallback(
    (item: SelectedNetworkItem) => {
      const channel = channelOf(snapshot, item);
      if (session == undefined || channel?.topics?.poll == undefined) {
        return;
      }
      // A wanted Channel delivers the sample to its panels. Otherwise the reply can still be read
      // in the Lynx Messages tab (Receive, `<`).
      if (channel.dataTopic == undefined || !session.hub.poll(channel.dataTopic)) {
        session.publish(channel.topics.poll, {}, { qos: 1 });
      }
    },
    [session, snapshot],
  );

  return { refresh, about, streamToggle, poll, isChannelStreaming };
}
