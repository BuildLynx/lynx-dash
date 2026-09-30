// SPDX-License-Identifier: MPL-2.0

import { Menu, MenuItem, Typography } from "@mui/material";
import { memo, useCallback, useMemo, useState } from "react";

import { classifyEndpointSection, collectEndpointRefsForBase } from "@lichtblick/suite-base/lynx/lynxMessagesNavigation";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import {
  NOTICE_SEVERITY_NAMES,
  type LynxChannelView,
  type LynxComponentView,
  type LynxEndpointAbout,
} from "@lichtblick/suite-base/lynx/types";
import { useLynxChannelRuntime } from "@lichtblick/suite-base/lynx/useLynxHub";

import { ChannelStreamSettings } from "./ChannelStreamSettings";
import type { SelectedNetworkItem } from "./LynxNetworkSelectionContext";
import { useStyles } from "./LynxNetworkSidebar.style";
import { channelStateLabel, componentStateLabel } from "./networkTreeUtils";
import { useViewInLynxMessages } from "./useViewInLynxMessages";

export type DetailPanelProps = {
  selected: SelectedNetworkItem;
};

function formatKeyList(keys: string[]): string {
  return keys.length > 0 ? keys.join(", ") : "(none)";
}

function DetailField({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <Typography variant="caption" display="block">
      {label}: {value}
    </Typography>
  );
}

type EndpointContextMenuState = {
  mouseX: number;
  mouseY: number;
  target: string;
  endpoint: string;
  section: "send" | "receive";
};

type EndpointListProps = {
  base: string;
  endpoints: Record<string, LynxEndpointAbout> | undefined;
};

function EndpointList({ base, endpoints }: EndpointListProps): React.JSX.Element {
  const { classes } = useStyles();
  const { viewEndpoint } = useViewInLynxMessages();
  const [contextMenu, setContextMenu] = useState<EndpointContextMenuState | undefined>(undefined);

  const refs = useMemo(() => collectEndpointRefsForBase(base, endpoints), [base, endpoints]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(undefined);
  }, []);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, suffix: string) => {
      event.preventDefault();
      const ref = refs.find((r) => r.suffix === suffix);
      if (ref == undefined) {
        return;
      }
      const section = classifyEndpointSection(ref);
      if (section == undefined) {
        return;
      }
      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
        target: base,
        endpoint: suffix,
        section,
      });
    },
    [base, refs],
  );

  if (refs.length === 0) {
    return <DetailField label="Endpoints" value="(none)" />;
  }

  return (
    <>
      <Typography variant="caption" display="block" className={classes.spacedTight}>
        Endpoints:
      </Typography>
      <div className={classes.endpointList}>
        {refs.map((ref) => (
          <Typography
            key={ref.suffix}
            variant="caption"
            component="div"
            className={classes.endpointRow}
            onContextMenu={(event) => {
              handleContextMenu(event, ref.suffix);
            }}
          >
            {ref.suffix === "" ? base : ref.fullTopic}
          </Typography>
        ))}
      </div>
      <Menu
        open={contextMenu != undefined}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu != undefined ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        <MenuItem
          onClick={() => {
            if (contextMenu != undefined) {
              viewEndpoint({
                target: contextMenu.target,
                endpoint: contextMenu.endpoint,
                section: contextMenu.section,
              });
            }
            handleCloseContextMenu();
          }}
        >
          View in Lynx Messages Tab
        </MenuItem>
      </Menu>
    </>
  );
}

function Description({ text }: { text: string }): React.JSX.Element | undefined {
  if (text === "") {
    return undefined;
  }
  return (
    <Typography variant="caption" color="text.secondary" display="block">
      {text}
    </Typography>
  );
}

function ChannelDetails({ channel, component }: { channel: LynxChannelView; component: LynxComponentView | undefined }): React.JSX.Element {
  const runtime = useLynxChannelRuntime(channel.dataTopic);
  return (
    <>
      <Typography variant="subtitle2">{channel.title}</Typography>
      <DetailField label="Name" value={channel.name} />
      {channel.key !== channel.name && <DetailField label="Key" value={channel.key} />}
      <DetailField label="Type" value="channel" />
      <DetailField label="Service" value={channel.servicePath} />
      <Description text={channel.description} />
      <DetailField label="State" value={channelStateLabel(channel.command, runtime)} />
      {component?.connected !== true && <DetailField label="Component" value="not connected" />}
      <ChannelStreamSettings channel={channel} />
      <EndpointList base={channel.base} endpoints={channel.endpoints} />
    </>
  );
}

function ComponentDetails({ component }: { component: LynxComponentView }): React.JSX.Element {
  const { classes } = useStyles();
  const session = useLynxRuntimeStore((s) => s.session);
  const channelKeys = Object.values(component.channels)
    .map((channel) => channel.name)
    .sort((a, b) => a.localeCompare(b));
  const notices = session?.network.recentNotices(component.path).slice(-5).reverse() ?? [];

  return (
    <>
      <Typography variant="subtitle2">{component.title}</Typography>
      <DetailField label="Name" value={component.name} />
      <DetailField label="Type" value={component.kind} />
      <Description text={component.description} />
      <DetailField
        label="Component"
        value={`${component.componentName}${component.lynxVersion !== "" ? `, Lynx ${component.lynxVersion}` : ""}`}
      />
      <DetailField label="State" value={componentStateLabel(component)} />
      {component.generation != undefined && <DetailField label="Generation" value={String(component.generation)} />}
      {component.noticeLevel != undefined && (
        <DetailField
          label="Notice level"
          value={`${component.noticeLevel} (${NOTICE_SEVERITY_NAMES[component.noticeLevel] ?? "unknown"} and above)`}
        />
      )}
      {component.timeSource != undefined && <DetailField label="Time source" value={component.timeSource} />}
      {!component.supportsSync && !component.loading && (
        <DetailField label="Sync" value="not offered; refresh fetches the whole About" />
      )}
      {component.kind === "service" && <DetailField label="Channels" value={formatKeyList(channelKeys)} />}
      {component.kind === "node" && (
        <>
          <DetailField label="Lists services" value={formatKeyList(component.listedServices)} />
          <DetailField label="Lists nodes" value={formatKeyList(component.listedNodes)} />
        </>
      )}
      {notices.length > 0 && (
        <>
          <Typography variant="caption" display="block" className={classes.spacedTight}>
            Recent notices:
          </Typography>
          {notices.map((notice) => (
            <Typography key={`${notice.receivedAt}-${notice.message}`} variant="caption" color="text.secondary" display="block">
              [{NOTICE_SEVERITY_NAMES[notice.severity] ?? notice.severity}] {notice.action !== "" ? `${notice.action}: ` : ""}
              {notice.message}
            </Typography>
          ))}
        </>
      )}
      <EndpointList base={component.path} endpoints={component.endpoints} />
    </>
  );
}

function DetailPanelComponent({ selected }: DetailPanelProps): React.JSX.Element {
  const { classes } = useStyles();
  const snapshot = useLynxRuntimeStore((s) => s.network);

  const content = ((): React.ReactNode => {
    if (selected == undefined) {
      return (
        <Typography variant="caption" color="text.secondary">
          Select an item to view details.
        </Typography>
      );
    }

    if (selected.kind === "unsupported") {
      const entry = snapshot.unsupported.find((u) => u.path === selected.path);
      return (
        <>
          <Typography variant="subtitle2">{selected.path}</Typography>
          <DetailField label="Type" value="unsupported" />
          <Typography variant="caption" color="text.secondary" display="block">
            {entry?.reason ?? "This component speaks a protocol this dashboard does not."}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" className={classes.spacedTight}>
            It needs to be updated to Lynx A3.0 before it can appear here.
          </Typography>
        </>
      );
    }

    if (selected.kind === "channel") {
      const component = snapshot.components[selected.servicePath];
      const channel = component?.channels[selected.channelKey];
      if (channel == undefined) {
        return (
          <Typography variant="caption" color="text.secondary">
            No channel metadata available.
          </Typography>
        );
      }
      return <ChannelDetails channel={channel} component={component} />;
    }

    const component = snapshot.components[selected.path];
    if (component == undefined) {
      return (
        <Typography variant="caption" color="text.secondary">
          No component metadata available.
        </Typography>
      );
    }
    return <ComponentDetails component={component} />;
  })();

  return <div className={classes.detail}>{content}</div>;
}

export const DetailPanel = memo(DetailPanelComponent);
