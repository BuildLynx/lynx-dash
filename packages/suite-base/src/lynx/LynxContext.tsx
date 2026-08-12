// SPDX-License-Identifier: MPL-2.0

import { createContext, useContext, useEffect, useMemo } from "react";
import { useStore } from "zustand";

import { lynxRuntimeStore, type LynxRuntime } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";

const LynxRuntimeContext = createContext<LynxRuntime | undefined>(undefined);

export function LynxRuntimeProvider(props: { children?: React.ReactNode }): React.JSX.Element {
  const runtime = useStore(lynxRuntimeStore, (store) => ({
    connected: store.connected,
    brokerUrl: store.brokerUrl,
    serviceId: store.serviceId,
    mqtt: store.mqtt,
    networkState: store.networkState,
    serviceIdentity: store.serviceIdentity,
    networkStateRoot: store.networkStateRoot,
    lynxMessagesPrefill: store.lynxMessagesPrefill,
  }));

  useEffect(() => {
    const tracker = runtime.networkState;
    if (!tracker) {
      return;
    }
    return tracker.subscribe((root) => {
      lynxRuntimeStore.getState().setRuntime({ networkStateRoot: root });
    });
  }, [runtime.networkState]);

  const value = useMemo(() => runtime, [runtime]);
  return <LynxRuntimeContext.Provider value={value}>{props.children}</LynxRuntimeContext.Provider>;
}

export function useLynxRuntime(): LynxRuntime | undefined {
  return useContext(LynxRuntimeContext);
}

export { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
