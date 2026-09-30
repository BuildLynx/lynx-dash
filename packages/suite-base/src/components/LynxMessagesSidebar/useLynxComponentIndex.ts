// SPDX-License-Identifier: MPL-2.0

import { useMemo } from "react";

import {
  collectEndpointsForBase,
  getReceiveEndpoints,
  getSendEndpoints,
  type LynxComponentBase,
  type LynxEndpointRef,
} from "@lichtblick/suite-base/components/LynxMessagesSidebar/lynxMessagesUtils";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import type { LynxNetworkSnapshot } from "@lichtblick/suite-base/lynx/types";

export type LynxComponentIndex = {
  bases: LynxComponentBase[];
  endpointsByBase: Map<string, LynxEndpointRef[]>;
  sendEndpointsByBase: Map<string, LynxEndpointRef[]>;
  receiveEndpointsByBase: Map<string, LynxEndpointRef[]>;
};

/**
 * Every component and Channel of the network as a "base": the topic prefix that its endpoint
 * topics extend. The About lists complete topics, so a base is simply what precedes the
 * endpoint name (`{path}` for a component, `{path}/{channel name}` for a Channel).
 */
export function buildLynxComponentIndex(snapshot: LynxNetworkSnapshot): LynxComponentIndex {
  const bases: LynxComponentBase[] = [];
  const endpointsByBase = new Map<string, LynxEndpointRef[]>();

  for (const component of Object.values(snapshot.components)) {
    const label = component.title !== component.name ? `${component.name} (${component.title})` : component.name;
    bases.push({ value: component.path, label });
    endpointsByBase.set(component.path, collectEndpointsForBase(component.path, component.endpoints));

    for (const channel of Object.values(component.channels)) {
      const channelLabel = channel.title !== channel.name ? `${channel.base} (${channel.title})` : channel.base;
      bases.push({ value: channel.base, label: channelLabel });
      endpointsByBase.set(channel.base, collectEndpointsForBase(channel.base, channel.endpoints));
    }
  }

  const sendEndpointsByBase = new Map<string, LynxEndpointRef[]>();
  const receiveEndpointsByBase = new Map<string, LynxEndpointRef[]>();
  for (const [base, refs] of endpointsByBase) {
    sendEndpointsByBase.set(base, getSendEndpoints(refs));
    receiveEndpointsByBase.set(base, getReceiveEndpoints(refs));
  }

  bases.sort((a, b) => a.label.localeCompare(b.label));

  return { bases, endpointsByBase, sendEndpointsByBase, receiveEndpointsByBase };
}

export function useLynxComponentIndex(): LynxComponentIndex {
  const snapshot = useLynxRuntimeStore((s) => s.network);

  return useMemo(() => buildLynxComponentIndex(snapshot), [snapshot]);
}

export function lookupEndpointsForBase(
  index: LynxComponentIndex,
  base: string,
  kind: "send" | "receive",
): LynxEndpointRef[] {
  const map = kind === "send" ? index.sendEndpointsByBase : index.receiveEndpointsByBase;
  return map.get(base) ?? [];
}
