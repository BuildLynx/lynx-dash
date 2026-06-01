// SPDX-License-Identifier: MPL-2.0

import { useCallback } from "react";

import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";

import type { SelectedNetworkItem } from "./LynxNetworkSelectionContext";

function aboutTargetId(item: SelectedNetworkItem): string | undefined {
  if (item == undefined) {
    return undefined;
  }
  switch (item.kind) {
    case "service":
      return item.serviceId;
    case "node":
      return item.nodeId;
    case "channel":
      return item.serviceId;
  }
}

export function useLynxNetworkActions(): {
  refresh: () => void;
  about: (item: SelectedNetworkItem) => void;
  streamToggle: (item: SelectedNetworkItem) => void;
  poll: (item: SelectedNetworkItem) => void;
  isChannelBusy: (item: SelectedNetworkItem) => boolean;
} {
  const mqtt = useLynxRuntimeStore((s) => s.mqtt);
  const networkState = useLynxRuntimeStore((s) => s.networkState);

  const refresh = useCallback(() => {
    mqtt?.publish("?/About", {});
  }, [mqtt]);

  const about = useCallback(
    (item: SelectedNetworkItem) => {
      const targetId = aboutTargetId(item);
      if (targetId == undefined) {
        return;
      }
      mqtt?.publish(`${targetId}/?/About`, {});
    },
    [mqtt],
  );

  const isChannelBusy = useCallback(
    (item: SelectedNetworkItem): boolean => {
      if (item?.kind !== "channel") {
        return false;
      }
      const channel = networkState?.getChannelAbout(item.serviceId, item.channelId);
      return channel?.status.state === "busy";
    },
    [networkState],
  );

  const streamToggle = useCallback(
    (item: SelectedNetworkItem) => {
      if (item?.kind !== "channel") {
        return;
      }
      if (isChannelBusy(item)) {
        mqtt?.stopStream(item.serviceId, item.channelId);
      } else {
        mqtt?.startStream(item.serviceId, item.channelId);
      }
    },
    [mqtt, isChannelBusy],
  );

  const poll = useCallback(
    (item: SelectedNetworkItem) => {
      if (item?.kind !== "channel") {
        return;
      }
      mqtt?.poll(item.serviceId, item.channelId);
    },
    [mqtt],
  );

  return { refresh, about, streamToggle, poll, isChannelBusy };
}
