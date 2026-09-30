// SPDX-License-Identifier: MPL-2.0

import { createContext } from "react";

export type SelectedNetworkItem =
  | { kind: "channel"; servicePath: string; channelKey: string }
  | { kind: "component"; path: string }
  | { kind: "unsupported"; path: string }
  | undefined;

export const LynxNetworkSelectionContext = createContext<(item: SelectedNetworkItem) => void>(() => {});
