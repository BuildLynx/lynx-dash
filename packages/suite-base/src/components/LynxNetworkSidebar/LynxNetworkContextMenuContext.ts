// SPDX-License-Identifier: MPL-2.0

import { createContext } from "react";

import type { SelectedNetworkItem } from "./LynxNetworkSelectionContext";

export type LynxNetworkContextMenuRequest = {
  item: SelectedNetworkItem;
  mouseX: number;
  mouseY: number;
};

export const LynxNetworkContextMenuContext = createContext<
  (request: LynxNetworkContextMenuRequest) => void
>(() => {});
