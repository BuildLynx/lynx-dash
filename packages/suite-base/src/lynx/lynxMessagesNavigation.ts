// SPDX-License-Identifier: MPL-2.0

import type { SelectedNetworkItem } from "@lichtblick/suite-base/components/LynxNetworkSidebar/LynxNetworkSelectionContext";
import {
  collectEndpointsForBase,
  isReceiveEndpoint,
  isSendEndpoint,
  type LynxEndpointRef,
} from "@lichtblick/suite-base/components/LynxMessagesSidebar/lynxMessagesUtils";
import { lynxRuntimeStore, type LynxMessagesPrefill } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import type { LynxEndpointAbout } from "@lichtblick/suite-base/lynx/types";
export function targetFromSelectedItem(item: SelectedNetworkItem): string | undefined {
  if (item == undefined) {
    return undefined;
  }
  switch (item.kind) {
    case "service":
      return item.serviceId;
    case "channel":
      return `${item.serviceId}/${item.channelId}`;
    case "node":
      return item.nodeId;
  }
}

export function classifyEndpointSection(ref: LynxEndpointRef): "send" | "receive" | undefined {
  if (isSendEndpoint(ref)) {
    return "send";
  }
  if (isReceiveEndpoint(ref)) {
    return "receive";
  }
  return undefined;
}

export function collectEndpointRefsForBase(
  base: string,
  endpoints: Record<string, LynxEndpointAbout> | undefined,
): LynxEndpointRef[] {
  return collectEndpointsForBase(base, endpoints);
}

export function viewInLynxMessages(
  selectRightSidebarItem: (item: "lynx-messages") => void,
  prefill: Omit<LynxMessagesPrefill, "id">,
): void {
  lynxRuntimeStore.getState().setLynxMessagesPrefill(prefill);
  selectRightSidebarItem("lynx-messages");
}
