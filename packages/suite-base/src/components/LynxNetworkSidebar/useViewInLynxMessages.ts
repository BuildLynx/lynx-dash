// SPDX-License-Identifier: MPL-2.0

import { useCallback } from "react";

import type { SelectedNetworkItem } from "@lichtblick/suite-base/components/LynxNetworkSidebar/LynxNetworkSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import type { LynxMessagesPrefill } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import {
  targetFromSelectedItem,
  viewInLynxMessages,
} from "@lichtblick/suite-base/lynx/lynxMessagesNavigation";

export function useViewInLynxMessages(): {
  viewComponent: (item: SelectedNetworkItem) => void;
  viewEndpoint: (prefill: Omit<LynxMessagesPrefill, "id">) => void;
} {
  const { sidebarActions } = useWorkspaceActions();

  const selectMessagesTab = useCallback((item: "lynx-messages") => {
    sidebarActions.right.selectItem(item);
  }, [sidebarActions]);

  const viewEndpoint = useCallback(
    (prefill: Omit<LynxMessagesPrefill, "id">) => {
      viewInLynxMessages(selectMessagesTab, prefill);
    },
    [selectMessagesTab],
  );

  const viewComponent = useCallback(
    (item: SelectedNetworkItem) => {
      const target = targetFromSelectedItem(item);
      if (target == undefined) {
        return;
      }
      viewInLynxMessages(selectMessagesTab, { target });
    },
    [selectMessagesTab],
  );

  return { viewComponent, viewEndpoint };
}
