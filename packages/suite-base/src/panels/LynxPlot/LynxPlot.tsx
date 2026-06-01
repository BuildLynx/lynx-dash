// SPDX-License-Identifier: MPL-2.0

import { Button, Tooltip, Fade, useTheme } from "@mui/material";
import * as _ from "lodash-es";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";

import { Immutable } from "@lichtblick/suite";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import {
  useMessagePipelineGetter,
  useMessagePipelineSubscribe,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { PanelContextMenu } from "@lichtblick/suite-base/components/PanelContextMenu";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import { PANEL_TOOLBAR_MIN_HEIGHT } from "@lichtblick/suite-base/components/PanelToolbar/constants";
import Stack from "@lichtblick/suite-base/components/Stack";
import TimeBasedChartTooltipContent from "@lichtblick/suite-base/components/TimeBasedChart/TimeBasedChartTooltipContent";
import useGlobalVariables from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import * as PanelAPI from "@lichtblick/suite-base/PanelAPI";
import useLynxPlotPanelSettings from "@lichtblick/suite-base/panels/LynxPlot/hooks/useLynxPlotPanelSettings";
import {
  computeLynxPlotSchemaYBounds,
  getChannelTitleForPath,
  isLynxSchemaTopic,
} from "@lichtblick/suite-base/panels/LynxPlot/utils/lynxPlotUtils";
import { DEFAULT_SIDEBAR_DIMENSION } from "@lichtblick/suite-base/panels/Plot/constants";
import { useStyles } from "@lichtblick/suite-base/panels/Plot/Plot.style";
import { PlotCoordinator } from "@lichtblick/suite-base/panels/Plot/PlotCoordinator";
import { PlotLegend } from "@lichtblick/suite-base/panels/Plot/PlotLegend";
import useGlobalSync from "@lichtblick/suite-base/panels/Plot/hooks/useGlobalSync";
import usePlotDataHandling from "@lichtblick/suite-base/panels/Plot/hooks/usePlotDataHandling";
import usePlotInteractionHandlers from "@lichtblick/suite-base/panels/Plot/hooks/usePlotInteractionHandlers";
import useRenderer from "@lichtblick/suite-base/panels/Plot/hooks/useRenderer";
import useSubscriptions from "@lichtblick/suite-base/panels/Plot/hooks/useSubscriptions";
import usePanning from "@lichtblick/suite-base/panels/Plot/hooks/usePanning";
import { VerticalBars } from "@lichtblick/suite-base/panels/Plot/VerticalBars";
import { PlotProps, TooltipStateSetter } from "@lichtblick/suite-base/panels/Plot/types";

const LynxPlot = (props: PlotProps): React.JSX.Element => {
  const { saveConfig, config } = props;
  const {
    paths: series,
    showLegend,
    xAxisVal: xAxisMode,
    legendDisplay = config.showSidebar === true ? "left" : "floating",
    sidebarDimension = config.sidebarWidth ?? DEFAULT_SIDEBAR_DIMENSION,
  } = config;

  const { classes } = useStyles();
  const theme = useTheme();
  const { t } = useTranslation("plot");

  const { setMessagePathDropConfig } = usePanelContext();
  const draggingRef = useRef(false);
  const networkState = useLynxRuntimeStore((s) => s.networkState);
  const networkStateRoot = useLynxRuntimeStore((s) => s.networkStateRoot);
  const { topics } = PanelAPI.useDataSourceInfo();

  const topicsByName = useMemo(
    () => new Map(topics.map((topic) => [topic.name, topic])),
    [topics],
  );

  const schemaBounds = useMemo(() => {
    return computeLynxPlotSchemaYBounds(config.paths, networkState);
    // networkStateRoot is intentionally included to recompute when About arrives,
    // but computeLynxPlotSchemaYBounds is cheap and returns structurally-equal results
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.paths, networkState, networkStateRoot]);

  const stableSchemaBounds = useRef(schemaBounds);
  if (
    schemaBounds?.min !== stableSchemaBounds.current?.min ||
    schemaBounds?.max !== stableSchemaBounds.current?.max
  ) {
    stableSchemaBounds.current = schemaBounds;
  }

  const plotConfig = useMemo(() => {
    const bounds = stableSchemaBounds.current;
    const minYValue = config.minYValue ?? bounds?.min;
    const maxYValue = config.maxYValue ?? bounds?.max;
    const changed = minYValue !== config.minYValue || maxYValue !== config.maxYValue;
    if (!changed) {
      return config;
    }
    return { ...config, minYValue, maxYValue };
  }, [config, stableSchemaBounds.current]);

  const [canReset, setCanReset] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState<TooltipStateSetter>();
  const [subscriberId] = useState(() => uuidv4());
  const [canvasDiv, setCanvasDiv] = useState<HTMLDivElement | ReactNull>(ReactNull);
  const [coordinator, setCoordinator] = useState<PlotCoordinator | undefined>(undefined);
  const shouldSync = config.isSynced;
  const renderer = useRenderer(canvasDiv, theme);
  const { globalVariables } = useGlobalVariables();
  const getMessagePipelineState = useMessagePipelineGetter();
  const subscribeMessagePipeline = useMessagePipelineSubscribe();
  const subscribeMessageRange = useSubscribeMessageRange();

  const {
    onMouseMove,
    onMouseOut,
    onResetView,
    onWheel,
    onClick,
    onClickPath,
    focusedPath,
    keyDownHandlers,
    keyUpHandlers,
    getPanelContextMenuItems,
  } = usePlotInteractionHandlers({
    config: plotConfig,
    coordinator,
    draggingRef,
    setActiveTooltip,
    renderer,
    shouldSync,
    subscriberId,
  });

  useLynxPlotPanelSettings(config, saveConfig, focusedPath);
  useSubscriptions(plotConfig, subscriberId);
  useGlobalSync(coordinator, setCanReset, { shouldSync }, subscriberId);
  usePanning(canvasDiv, coordinator, draggingRef);
  const { colorsByDatasetIndex, labelsByDatasetIndex, datasetsBuilder } = usePlotDataHandling(
    plotConfig,
    globalVariables,
  );

  useEffect(() => {
    setMessagePathDropConfig({
      getDropStatus(paths) {
        if (paths.some((path) => !path.isLeaf)) {
          return { canDrop: false };
        }
        const topic = topicsByName.get(paths[0]?.topicName ?? "");
        if (!isLynxSchemaTopic(topic)) {
          return { canDrop: false };
        }
        return { canDrop: true, effect: "add" };
      },
      handleDrop(paths) {
        saveConfig((prevConfig) => ({
          ...prevConfig,
          paths: [
            ...prevConfig.paths,
            ...paths
              .filter((path) => isLynxSchemaTopic(topicsByName.get(path.topicName)))
              .map((path) => {
                const label = getChannelTitleForPath(path.path, networkState);
                return {
                  value: path.path,
                  enabled: true,
                  timestampMethod: "receiveTime" as const,
                  ...(label != undefined ? { label } : {}),
                };
              }),
          ],
        }));
      },
    });
  }, [networkState, saveConfig, setMessagePathDropConfig, topicsByName]);

  useEffect(() => {
    coordinator?.handleConfig(plotConfig, theme.palette.mode, globalVariables);

    if (coordinator) {
      coordinator.handlePlayerState(getMessagePipelineState().playerState);
    }
  }, [coordinator, plotConfig, globalVariables, theme.palette.mode, getMessagePipelineState]);

  useEffect(() => {
    if (!coordinator) {
      return;
    }

    const unsub = subscribeMessagePipeline((state) => {
      coordinator.handlePlayerState(state.playerState);
    });

    coordinator.handlePlayerState(getMessagePipelineState().playerState);
    return unsub;
  }, [coordinator, getMessagePipelineState, subscribeMessagePipeline]);

  useEffect(() => {
    if (coordinator) {
      coordinator.setShouldSync({ shouldSync });
    }
  }, [coordinator, shouldSync]);

  useEffect(() => {
    if (!renderer || !canvasDiv) {
      return;
    }

    const contentRect = canvasDiv.getBoundingClientRect();

    const plotCoordinator = new PlotCoordinator(renderer, datasetsBuilder, subscribeMessageRange);
    setCoordinator(plotCoordinator);

    plotCoordinator.setSize({
      width: contentRect.width,
      height: contentRect.height,
    });

    const isCanvasTarget = (entry: Immutable<ResizeObserverEntry>) => entry.target === canvasDiv;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = _.findLast(entries, isCanvasTarget);
      if (entry != undefined) {
        plotCoordinator.setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    resizeObserver.observe(canvasDiv);

    return () => {
      resizeObserver.disconnect();
      plotCoordinator.destroy();
    };
  }, [canvasDiv, datasetsBuilder, renderer, subscribeMessageRange]);

  const numSeries = config.paths.length;
  const tooltipContent = useMemo(() => {
    return activeTooltip ? (
      <TimeBasedChartTooltipContent
        content={activeTooltip.data}
        multiDataset={numSeries > 1}
        colorsByConfigIndex={colorsByDatasetIndex}
        labelsByConfigIndex={labelsByDatasetIndex}
      />
    ) : undefined;
  }, [activeTooltip, colorsByDatasetIndex, labelsByDatasetIndex, numSeries]);

  const hoveredValuesBySeriesIndex = useMemo(() => {
    if (!config.showPlotValuesInLegend || !activeTooltip?.data) {
      return;
    }

    const values = new Array(config.paths.length).fill(undefined);
    for (const item of activeTooltip.data) {
      values[item.configIndex] ??= item.value;
    }

    return values;
  }, [activeTooltip, config.paths.length, config.showPlotValuesInLegend]);

  return (
    <Stack
      flex="auto"
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
      position="relative"
    >
      <PanelToolbar />
      <Stack
        direction={legendDisplay === "top" ? "column" : "row"}
        flex="auto"
        fullWidth
        style={{ height: `calc(100% - ${PANEL_TOOLBAR_MIN_HEIGHT}px)` }}
        position="relative"
      >
        {legendDisplay !== "none" && (
          <PlotLegend
            coordinator={coordinator}
            legendDisplay={legendDisplay}
            onClickPath={onClickPath}
            paths={series}
            saveConfig={saveConfig}
            showLegend={showLegend}
            sidebarDimension={sidebarDimension}
            showValues={config.showPlotValuesInLegend}
            hoveredValuesBySeriesIndex={hoveredValuesBySeriesIndex}
          />
        )}
        <Tooltip
          arrow={false}
          classes={{ tooltip: classes.tooltip }}
          open={tooltipContent != undefined}
          placement="right"
          title={tooltipContent ?? <></>}
          disableInteractive
          followCursor
          slots={{ transition: Fade }}
          slotProps={{ transition: { timeout: 0 } }}
        >
          <div className={classes.verticalBarWrapper} data-testid="vertical-bar-wrapper">
            <div
              className={classes.canvasDiv}
              ref={setCanvasDiv}
              onWheel={onWheel}
              onMouseMove={onMouseMove}
              onMouseOut={onMouseOut}
              onClick={onClick}
              onDoubleClick={onResetView}
            />
            <VerticalBars
              coordinator={coordinator}
              hoverComponentId={subscriberId}
              xAxisIsPlaybackTime={xAxisMode === "timestamp"}
            />
          </div>
        </Tooltip>
        {canReset && (
          <div className={classes.resetZoomButton} data-testid="plot-reset-view-button">
            <Button
              variant="contained"
              color="inherit"
              title="(shortcut: double-click)"
              onClick={onResetView}
            >
              {t("resetView")}
            </Button>
          </div>
        )}
        <PanelContextMenu getItems={getPanelContextMenuItems} />
      </Stack>
      <KeyListener global keyDownHandlers={keyDownHandlers} keyUpHandlers={keyUpHandlers} />
    </Stack>
  );
};

export default LynxPlot;
