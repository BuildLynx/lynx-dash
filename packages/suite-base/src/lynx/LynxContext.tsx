// SPDX-License-Identifier: MPL-2.0

import { createContext, useContext, useEffect, useMemo } from "react";
import { useStore } from "zustand";

import { lynxRuntimeStore, type LynxRuntime } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";

const LynxRuntimeContext = createContext<LynxRuntime | undefined>(undefined);

export function LynxRuntimeProvider(props: { children?: React.ReactNode }): React.JSX.Element {
  const runtime = useStore(lynxRuntimeStore, (store) => ({
    connected: store.connected,
    brokerUrl: store.brokerUrl,
    deploymentName: store.deploymentName,
    session: store.session,
    network: store.network,
    lynxMessagesPrefill: store.lynxMessagesPrefill,
  }));

  // Keep the store's snapshot current with the session's network.
  useEffect(() => {
    const network = runtime.session?.network;
    if (!network) {
      return;
    }
    lynxRuntimeStore.getState().setRuntime({ network: network.snapshot() });
    return network.subscribe((snapshot) => {
      lynxRuntimeStore.getState().setRuntime({ network: snapshot });
    });
  }, [runtime.session]);

  const value = useMemo(() => runtime, [runtime]);
  return <LynxRuntimeContext.Provider value={value}>{props.children}</LynxRuntimeContext.Provider>;
}

export function useLynxRuntime(): LynxRuntime | undefined {
  return useContext(LynxRuntimeContext);
}

export { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
