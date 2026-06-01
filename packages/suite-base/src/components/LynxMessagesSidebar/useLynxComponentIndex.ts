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
import type {
  LynxChannelAbout,
  LynxNetworkStateRoot,
  LynxServiceAbout,
} from "@lichtblick/suite-base/lynx/types";

export type LynxComponentIndex = {
  bases: LynxComponentBase[];
  endpointsByBase: Map<string, LynxEndpointRef[]>;
  sendEndpointsByBase: Map<string, LynxEndpointRef[]>;
  receiveEndpointsByBase: Map<string, LynxEndpointRef[]>;
};

function addBase(
  bases: LynxComponentBase[],
  seen: Set<string>,
  value: string,
  label: string,
): void {
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  bases.push({ value, label });
}

function indexService(
  serviceId: string,
  service: LynxServiceAbout,
  pathPrefix: string,
  bases: LynxComponentBase[],
  seen: Set<string>,
  endpointsByBase: Map<string, LynxEndpointRef[]>,
): void {
  const displayPrefix = pathPrefix !== "" ? `${pathPrefix}/` : "";
  const serviceValue = pathPrefix !== "" ? `${pathPrefix}/${serviceId}` : serviceId;
  const serviceLabel =
    service.docs?.title != undefined && service.docs.title !== ""
      ? `${displayPrefix}${service.docs.title} (${serviceId})`
      : `${displayPrefix}${serviceId}`;

  addBase(bases, seen, serviceValue, serviceLabel);
  const serviceEndpoints = collectEndpointsForBase(serviceValue, service.endpoints);
  endpointsByBase.set(serviceValue, serviceEndpoints);

  const channels = service.channels ?? {};
  for (const [channelId, channel] of Object.entries(channels)) {
    if (channel == undefined) {
      continue;
    }
    indexChannel(serviceId, channelId, channel, serviceValue, pathPrefix, bases, seen, endpointsByBase);
  }
}

function indexChannel(
  serviceId: string,
  channelId: string,
  channel: LynxChannelAbout,
  serviceBase: string,
  pathPrefix: string,
  bases: LynxComponentBase[],
  seen: Set<string>,
  endpointsByBase: Map<string, LynxEndpointRef[]>,
): void {
  const flatValue = `${serviceId}/${channelId}`;
  const pathValue = pathPrefix !== "" ? `${pathPrefix}/${serviceId}/${channelId}` : flatValue;
  const title = channel.docs?.title ?? channelId;
  const flatLabel = `${title} (${flatValue})`;
  const pathLabel = pathPrefix !== "" ? `${pathPrefix}/${serviceId}/${title} (${channelId})` : flatLabel;

  addBase(bases, seen, flatValue, flatLabel);
  if (pathValue !== flatValue) {
    addBase(bases, seen, pathValue, pathLabel);
  }

  const flatEndpoints = collectEndpointsForBase(flatValue, channel.endpoints);
  endpointsByBase.set(flatValue, flatEndpoints);
  if (pathValue !== flatValue) {
    endpointsByBase.set(pathValue, flatEndpoints);
  }

  // Also allow service-relative channel base
  const serviceChannelBase = `${serviceBase}/${channelId}`;
  if (serviceChannelBase !== flatValue && serviceChannelBase !== pathValue) {
    addBase(bases, seen, serviceChannelBase, `${title} (${serviceChannelBase})`);
    endpointsByBase.set(serviceChannelBase, flatEndpoints);
  }
}

function walkNetwork(
  root: LynxNetworkStateRoot,
  pathPrefix: string,
  bases: LynxComponentBase[],
  seen: Set<string>,
  endpointsByBase: Map<string, LynxEndpointRef[]>,
): void {
  for (const [serviceId, service] of Object.entries(root.services)) {
    if (service == undefined) {
      continue;
    }
    indexService(serviceId, service, pathPrefix, bases, seen, endpointsByBase);
  }

  for (const [nodeId, nodeState] of Object.entries(root.childNodes)) {
    const nodePath = pathPrefix !== "" ? `${pathPrefix}/${nodeId}` : nodeId;
    walkNetwork(nodeState, nodePath, bases, seen, endpointsByBase);
  }
}

export function buildLynxComponentIndex(networkStateRoot: LynxNetworkStateRoot): LynxComponentIndex {
  const bases: LynxComponentBase[] = [];
  const seen = new Set<string>();
  const endpointsByBase = new Map<string, LynxEndpointRef[]>();

  walkNetwork(networkStateRoot, "", bases, seen, endpointsByBase);

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
  const networkStateRoot = useLynxRuntimeStore((s) => s.networkStateRoot);

  return useMemo(() => buildLynxComponentIndex(networkStateRoot), [networkStateRoot]);
}

export function lookupEndpointsForBase(
  index: LynxComponentIndex,
  base: string,
  kind: "send" | "receive",
): LynxEndpointRef[] {
  const map = kind === "send" ? index.sendEndpointsByBase : index.receiveEndpointsByBase;
  return map.get(base) ?? [];
}
