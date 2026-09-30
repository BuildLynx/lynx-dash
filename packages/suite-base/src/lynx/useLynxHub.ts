// SPDX-License-Identifier: MPL-2.0

import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { LynxChannelRuntime } from "@lichtblick/suite-base/lynx/LynxChannelHub";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";

const NO_UNSUBSCRIBE = (): void => {};

/** What the dash is doing with a Channel (streaming, sharing, stopped), kept current for the UI. */
export function useLynxChannelRuntime(dataTopic: string | undefined): LynxChannelRuntime | undefined {
  const session = useLynxRuntimeStore((s) => s.session);
  const subscribe = useCallback(
    (onChange: () => void) => session?.hub.subscribe(onChange) ?? NO_UNSUBSCRIBE,
    [session],
  );
  const version = useSyncExternalStore(subscribe, () => session?.hub.getVersion() ?? 0);

  return useMemo(
    () => (session != undefined && dataTopic != undefined ? session.hub.runtime(dataTopic) : undefined),
    // `version` is what says the hub's state moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, dataTopic, version],
  );
}
