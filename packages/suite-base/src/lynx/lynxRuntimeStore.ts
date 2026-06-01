// SPDX-License-Identifier: MPL-2.0

import { createStore, useStore } from "zustand";

import type { LynxMqttManager } from "@lichtblick/suite-base/lynx/LynxMqttManager";
import type { LynxNetworkStateTracker } from "@lichtblick/suite-base/lynx/LynxNetworkState";
import type { LynxServiceIdentity } from "@lichtblick/suite-base/lynx/LynxServiceIdentity";
import type { LynxNetworkStateRoot } from "@lichtblick/suite-base/lynx/types";

export type LynxRuntime = {
  connected: boolean;
  brokerUrl: string | undefined;
  serviceId: string | undefined;
  mqtt: LynxMqttManager | undefined;
  networkState: LynxNetworkStateTracker | undefined;
  serviceIdentity: LynxServiceIdentity | undefined;
  networkStateRoot: LynxNetworkStateRoot;
};

export type LynxRuntimeStore = LynxRuntime & {
  setRuntime: (runtime: Partial<LynxRuntime>) => void;
  clearRuntime: () => void;
};

const initialNetworkState: LynxNetworkStateRoot = { services: {}, childNodes: {} };

export const lynxRuntimeStore = createStore<LynxRuntimeStore>((set) => ({
  connected: false,
  brokerUrl: undefined,
  serviceId: undefined,
  mqtt: undefined,
  networkState: undefined,
  serviceIdentity: undefined,
  networkStateRoot: initialNetworkState,
  setRuntime: (runtime) => {
    set((state) => ({ ...state, ...runtime }));
  },
  clearRuntime: () => {
    set({
      connected: false,
      brokerUrl: undefined,
      serviceId: undefined,
      mqtt: undefined,
      networkState: undefined,
      serviceIdentity: undefined,
      networkStateRoot: initialNetworkState,
    });
  },
}));

export function useLynxRuntimeStore<T>(selector: (store: LynxRuntimeStore) => T): T {
  return useStore(lynxRuntimeStore, selector);
}
