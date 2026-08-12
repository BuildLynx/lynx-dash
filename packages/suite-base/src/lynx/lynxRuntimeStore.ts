// SPDX-License-Identifier: MPL-2.0

import { createStore, useStore } from "zustand";

import type { LynxMqttManager } from "@lichtblick/suite-base/lynx/LynxMqttManager";
import type { LynxNetworkStateTracker } from "@lichtblick/suite-base/lynx/LynxNetworkState";
import type { LynxServiceIdentity } from "@lichtblick/suite-base/lynx/LynxServiceIdentity";
import type { LynxNetworkStateRoot } from "@lichtblick/suite-base/lynx/types";

export type LynxMessagesPrefill = {
  id: number;
  target: string;
  endpoint?: string;
  section?: "send" | "receive";
};

export type LynxRuntime = {
  connected: boolean;
  brokerUrl: string | undefined;
  serviceId: string | undefined;
  mqtt: LynxMqttManager | undefined;
  networkState: LynxNetworkStateTracker | undefined;
  serviceIdentity: LynxServiceIdentity | undefined;
  networkStateRoot: LynxNetworkStateRoot;
  lynxMessagesPrefill: LynxMessagesPrefill | undefined;
};

export type LynxRuntimeStore = LynxRuntime & {
  setRuntime: (runtime: Partial<LynxRuntime>) => void;
  clearRuntime: () => void;
  setLynxMessagesPrefill: (prefill: Omit<LynxMessagesPrefill, "id"> | undefined) => void;
  clearLynxMessagesPrefill: () => void;
};

let nextLynxMessagesPrefillId = 1;

const initialNetworkState: LynxNetworkStateRoot = { services: {}, childNodes: {} };

export const lynxRuntimeStore = createStore<LynxRuntimeStore>((set) => ({
  connected: false,
  brokerUrl: undefined,
  serviceId: undefined,
  mqtt: undefined,
  networkState: undefined,
  serviceIdentity: undefined,
  networkStateRoot: initialNetworkState,
  lynxMessagesPrefill: undefined,
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
      lynxMessagesPrefill: undefined,
    });
  },
  setLynxMessagesPrefill: (prefill) => {
    set((state) => ({
      ...state,
      lynxMessagesPrefill:
        prefill == undefined
          ? undefined
          : { ...prefill, id: nextLynxMessagesPrefillId++ },
    }));
  },
  clearLynxMessagesPrefill: () => {
    set((state) => ({ ...state, lynxMessagesPrefill: undefined }));
  },
}));

export function useLynxRuntimeStore<T>(selector: (store: LynxRuntimeStore) => T): T {
  return useStore(lynxRuntimeStore, selector);
}
