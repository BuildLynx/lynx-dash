// SPDX-License-Identifier: MPL-2.0

import { createStore, useStore } from "zustand";

import type { LynxSession } from "@lichtblick/suite-base/lynx/LynxSession";
import { EMPTY_NETWORK_SNAPSHOT, type LynxNetworkSnapshot } from "@lichtblick/suite-base/lynx/types";

export type LynxMessagesPrefill = {
  id: number;
  target: string;
  endpoint?: string;
  section?: "send" | "receive";
};

export type LynxRuntime = {
  connected: boolean;
  brokerUrl: string | undefined;
  /** This dash's own deployed name on the network. */
  deploymentName: string | undefined;
  session: LynxSession | undefined;
  /** The latest snapshot of the network, kept current by the player. */
  network: LynxNetworkSnapshot;
  lynxMessagesPrefill: LynxMessagesPrefill | undefined;
};

export type LynxRuntimeStore = LynxRuntime & {
  setRuntime: (runtime: Partial<LynxRuntime>) => void;
  clearRuntime: () => void;
  setLynxMessagesPrefill: (prefill: Omit<LynxMessagesPrefill, "id"> | undefined) => void;
  clearLynxMessagesPrefill: () => void;
};

let nextLynxMessagesPrefillId = 1;

export const lynxRuntimeStore = createStore<LynxRuntimeStore>((set) => ({
  connected: false,
  brokerUrl: undefined,
  deploymentName: undefined,
  session: undefined,
  network: EMPTY_NETWORK_SNAPSHOT,
  lynxMessagesPrefill: undefined,
  setRuntime: (runtime) => {
    set((state) => ({ ...state, ...runtime }));
  },
  clearRuntime: () => {
    set({
      connected: false,
      brokerUrl: undefined,
      deploymentName: undefined,
      session: undefined,
      network: EMPTY_NETWORK_SNAPSHOT,
      lynxMessagesPrefill: undefined,
    });
  },
  setLynxMessagesPrefill: (prefill) => {
    set((state) => ({
      ...state,
      lynxMessagesPrefill: prefill == undefined ? undefined : { ...prefill, id: nextLynxMessagesPrefillId++ },
    }));
  },
  clearLynxMessagesPrefill: () => {
    set((state) => ({ ...state, lynxMessagesPrefill: undefined }));
  },
}));

export function useLynxRuntimeStore<T>(selector: (store: LynxRuntimeStore) => T): T {
  return useStore(lynxRuntimeStore, selector);
}
