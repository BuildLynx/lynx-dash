// SPDX-License-Identifier: MPL-2.0

import { useState } from "react";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { ReceiveSection } from "@lichtblick/suite-base/components/LynxMessagesSidebar/ReceiveSection";
import { SendSection } from "@lichtblick/suite-base/components/LynxMessagesSidebar/SendSection";
import { SidebarContent } from "@lichtblick/suite-base/components/SidebarContent";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";

import { useStyles } from "./LynxMessagesSidebar.style";

export function LynxMessagesSidebar(): React.JSX.Element {
  const { classes } = useStyles();
  const connected = useLynxRuntimeStore((s) => s.connected);
  const [lastSendAt, setLastSendAt] = useState<number | undefined>(undefined);

  return (
    <SidebarContent title="Lynx Messages" disablePadding>
      {!connected ? (
        <EmptyState>Connect to a Lynx network to send and receive messages.</EmptyState>
      ) : (
        <div className={classes.root}>
          <SendSection onSend={setLastSendAt} />
          <ReceiveSection lastSendAt={lastSendAt} />
        </div>
      )}
    </SidebarContent>
  );
}
