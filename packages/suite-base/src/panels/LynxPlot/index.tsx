// SPDX-License-Identifier: MPL-2.0

import Panel from "@lichtblick/suite-base/components/Panel";

import LynxPlot from "./LynxPlot";
import { DEFAULT_LYNX_PLOT_CONFIG } from "./constants";

export default Panel(
  Object.assign(LynxPlot, {
    panelType: "LynxPlot",
    defaultConfig: DEFAULT_LYNX_PLOT_CONFIG,
  }),
);
