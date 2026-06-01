// SPDX-License-Identifier: MPL-2.0

import { createContext } from "react";

export type SelectedNetworkItem =
  | { kind: "channel"; serviceId: string; channelId: string }
  | { kind: "service"; serviceId: string }
  | { kind: "node"; nodeId: string }
  | undefined;

export const LynxNetworkSelectionContext = createContext<
  (item: SelectedNetworkItem) => void
>(() => {});
