// SPDX-License-Identifier: MPL-2.0

import type { LynxChannelRuntime } from "@lichtblick/suite-base/lynx/LynxChannelHub";
import type { LynxComponentView } from "@lichtblick/suite-base/lynx/types";

/** What the tree says next to a component's name. */
export type ComponentStateLabel = "connected" | "down" | "stale" | "loading";

export function componentStateLabel(component: LynxComponentView): ComponentStateLabel {
  if (component.connected === false) {
    return "down";
  }
  if (component.loading) {
    return "loading";
  }
  // Up, but its About cannot be trusted right now (it is being refreshed, or a Node above it is down).
  if (component.stale) {
    return "stale";
  }
  return "connected";
}

/** A component that is not serving: dim it, and everything beneath it. */
export function isDimmedComponent(component: LynxComponentView): boolean {
  return component.connected !== true;
}

export function formatStateSuffix(label: string | undefined): string {
  return ` (${label ?? "unknown"})`;
}

/** Filled while data is flowing (a Stream is running), hollow otherwise. */
export function channelStatusIcon(state: "streaming" | "idle"): string {
  return state === "streaming" ? "●" : "○";
}

/** A short label for a Channel's running command. */
export function channelStateLabel(command: { command: string } | null | undefined, runtime?: LynxChannelRuntime): string {
  if (command == undefined) {
    return runtime?.starting === true ? "starting" : "idle";
  }
  if (command.command !== "Stream") {
    return command.command.toLowerCase();
  }
  return runtime?.ownership === "shared" ? "streaming, shared" : "streaming";
}
