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
/** The topic prefix of the selected component or Channel: what the Messages tab calls its "Component". */
export function targetFromSelectedItem(item: SelectedNetworkItem): string | undefined {
  if (item == undefined) {
    return undefined;
  }
  switch (item.kind) {
    case "component":
    case "unsupported":
      return item.path;
    case "channel": {
      const channel = lynxRuntimeStore.getState().network.components[item.servicePath]?.channels[item.channelKey];
      return channel?.base ?? `${item.servicePath}/${item.channelKey}`;
    }
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
