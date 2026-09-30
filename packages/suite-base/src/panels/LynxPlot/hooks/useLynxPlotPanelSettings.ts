// SPDX-License-Identifier: MPL-2.0

import { produce } from "immer";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SettingsTreeAction } from "@lichtblick/suite";
import * as PanelAPI from "@lichtblick/suite-base/PanelAPI";
import { useLynxRuntimeStore } from "@lichtblick/suite-base/lynx/lynxRuntimeStore";
import type { LynxNetworkSnapshot } from "@lichtblick/suite-base/lynx/types";
import { DEFAULT_PLOT_PATH } from "@lichtblick/suite-base/panels/LynxPlot/constants";
import { buildLynxPlotSettingsTree } from "@lichtblick/suite-base/panels/LynxPlot/utils/buildSettingsTree";
import { getChannelTitleForPath } from "@lichtblick/suite-base/panels/LynxPlot/utils/lynxPlotUtils";
import {
  handleDeleteSeriesAction,
  handleMoveSeriesAction,
  handleUpdateAction,
} from "@lichtblick/suite-base/panels/Plot/hooks/usePlotPanelSettings";
import { PlotConfig } from "@lichtblick/suite-base/panels/Plot/utils/config";
import {
  assignDefaultColorsToSeries,
  handleReorderSeriesAction,
} from "@lichtblick/suite-base/panels/utils";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { lineColors } from "@lichtblick/suite-base/util/plotColors";

function handleAddLynxSeriesAction({
  draft,
  network,
}: {
  draft: PlotConfig;
  network: LynxNetworkSnapshot | undefined;
}): void {
  if (draft.paths.length === 0) {
    draft.paths.push({ ...DEFAULT_PLOT_PATH });
  }
  const newIndex = draft.paths.length;
  const newPath = {
    ...DEFAULT_PLOT_PATH,
    color: lineColors[newIndex % lineColors.length],
  };
  const title = getChannelTitleForPath(newPath.value, network);
  if (title != undefined) {
    newPath.label = title;
  }
  draft.paths.push(newPath);
}

export default function useLynxPlotPanelSettings(
  config: PlotConfig,
  saveConfig: SaveConfig<PlotConfig>,
  focusedPath?: readonly string[],
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { t } = useTranslation("plot");
  const { t: tPanels } = useTranslation("panels");
  const { topics } = PanelAPI.useDataSourceInfo();
  const network = useLynxRuntimeStore((s) => s.network);

  const topicsByName = useMemo(
    () => new Map(topics.map((topic) => [topic.name, topic])),
    [topics],
  );

  const nonLynxPathError = tPanels("lynxPlotNonLynxTopicError");

  const actionHandler = useCallback(
    ({ action, payload }: SettingsTreeAction) => {
      if (action === "update") {
        const { path, value } = payload;
        saveConfig(
          produce((draft: PlotConfig) => {
            handleUpdateAction({ draft, path, value });
          }),
        );
      } else if (action === "reorder-node") {
        const sourceIndex = Number(payload.path[1]);
        const targetIndex = Number(payload.targetPath[1]);
        saveConfig(
          produce<PlotConfig>((draft) => {
            assignDefaultColorsToSeries(draft.paths);
            handleReorderSeriesAction(draft, sourceIndex, targetIndex);
          }),
        );
      } else if (payload.id === "add-series") {
        saveConfig(
          produce<PlotConfig>((draft: PlotConfig) => {
            handleAddLynxSeriesAction({ draft, network });
          }),
        );
      } else if (payload.id === "delete-series") {
        saveConfig(
          produce<PlotConfig>((draft) => {
            handleDeleteSeriesAction({ draft, index: Number(payload.path[1]) });
          }),
        );
      } else if (payload.id === "move-series-up") {
        saveConfig(
          produce<PlotConfig>((draft) => {
            handleMoveSeriesAction({ draft, index: Number(payload.path[1]), direction: "up" });
          }),
        );
      } else if (payload.id === "move-series-down") {
        saveConfig(
          produce<PlotConfig>((draft) => {
            handleMoveSeriesAction({ draft, index: Number(payload.path[1]), direction: "down" });
          }),
        );
      }
    },
    [network, saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      focusedPath,
      nodes: buildLynxPlotSettingsTree(config, t, topicsByName, nonLynxPathError),
    });
  }, [
    actionHandler,
    config,
    focusedPath,
    nonLynxPathError,
    topicsByName,
    updatePanelSettingsTree,
    t,
  ]);
}
