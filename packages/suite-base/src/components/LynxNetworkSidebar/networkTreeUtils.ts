// SPDX-License-Identifier: MPL-2.0

import type { LynxComponentState } from "@lichtblick/suite-base/lynx/types";

export function getStatusState(
  data: { status?: { state?: LynxComponentState } } | undefined,
): LynxComponentState | undefined {
  return data?.status?.state;
}

export function isDimmedState(state: LynxComponentState | undefined): boolean {
  return state === "disconnected" || state === "disabled";
}

export function formatStateSuffix(state: LynxComponentState | undefined): string {
  return ` (${state ?? "unknown"})`;
}

export function channelStatusIcon(state: LynxComponentState | undefined): string {
  return state === "busy" ? "\u25CF" : "\u25CB";
}
