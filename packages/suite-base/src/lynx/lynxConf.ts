// SPDX-License-Identifier: MPL-2.0

export type LynxConf = {
  UpstreamNodeHost?: string;
  UpstreamNodePort?: number;
};

let cachedConf: LynxConf | undefined;
let loadPromise: Promise<LynxConf | undefined> | undefined;

export const DEFAULT_LYNX_BROKER_URL = "ws://localhost:9001";

export async function loadLynxConf(): Promise<LynxConf | undefined> {
  if (cachedConf != undefined) {
    return cachedConf;
  }
  if (loadPromise != undefined) {
    return await loadPromise;
  }

  loadPromise = (async () => {
    try {
      const response = await fetch("/lynxConf.json");
      if (response.ok) {
        cachedConf = (await response.json()) as LynxConf;
        return cachedConf;
      }
    } catch {
      // Optional config file — ignore fetch errors.
    }
    return undefined;
  })();

  return await loadPromise;
}

export function brokerWebSocketUrlFromConf(conf: LynxConf): string {
  const host = conf.UpstreamNodeHost ?? "localhost";
  const port = conf.UpstreamNodePort ?? 9001;
  return `ws://${host}:${port}`;
}

export async function resolveBrokerUrl(userUrl: string | undefined): Promise<string> {
  if (userUrl != undefined && userUrl.trim() !== "" && userUrl !== "auto") {
    return userUrl.trim();
  }
  const conf = await loadLynxConf();
  if (conf != undefined) {
    return brokerWebSocketUrlFromConf(conf);
  }
  return DEFAULT_LYNX_BROKER_URL;
}
