// SPDX-License-Identifier: MPL-2.0

import {
  LocalStorageDeploymentStore,
  MemoryDeploymentStore,
  defaultDeploymentName,
  deploymentStorageKey,
  generateDeploymentSuffix,
  resolveDeploymentName,
  type DeploymentStore,
  type StorageLike,
} from "lynx-sdk-typescript";

/** `component.name` of the dash: who wrote it. Its deployed name (one per browser tab) is `lynxDash-xxxxxxxx`. */
export const LYNX_DASH_COMPONENT_NAME = "lynxDash";

/** The part of the Web Locks API used to tell two tabs apart. */
export interface LockManagerLike {
  request: (
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<unknown>,
  ) => Promise<unknown>;
}

export interface ClaimDeploymentOptions {
  /** A name the user chose. It is used as given: two tabs that choose the same name are the user's doing. */
  requestedName?: string;
  /** Where the tab's generated name is kept. `sessionStorage` gives one identity per tab. */
  storage?: StorageLike;
  /** Defaults to `navigator.locks`. Without it, a duplicated tab keeps the name it was copied with. */
  locks?: LockManagerLike;
  generateSuffix?: () => string;
}

export interface ClaimedDeployment {
  name: string;
  deploymentStore: DeploymentStore;
  /** True when the name will still be there after a reload of this tab. */
  persistent: boolean;
}

const MAX_ATTEMPTS = 8;

function defaultLocks(): LockManagerLike | undefined {
  const locks = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
  return locks;
}

/**
 * Try to become the only holder of `name`. The lock is held until the page goes away, which is
 * what makes a second tab that inherited the same stored name notice that it is a copy.
 */
async function claim(locks: LockManagerLike, name: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    void locks.request(`lynx:deployment:${name}`, { ifAvailable: true }, async (lock) => {
      resolve(lock != undefined);
      if (lock != undefined) {
        // Holding the lock means never settling this promise.
        await new Promise<never>(() => {});
      }
    });
  });
}

/**
 * Decide the dash's deployed name for this tab: the user's name if they gave one, otherwise a
 * generated `lynxDash-xxxxxxxx` remembered for the life of the tab. A tab that was duplicated
 * inherits its original's stored name; it detects that with a lock and takes a new one.
 */
export async function claimDashDeployment(options: ClaimDeploymentOptions = {}): Promise<ClaimedDeployment> {
  const store: DeploymentStore = options.storage != undefined ? new LocalStorageDeploymentStore(options.storage) : new MemoryDeploymentStore();
  const requestedName = options.requestedName?.trim() === "" ? undefined : options.requestedName?.trim();
  const locks = options.locks ?? defaultLocks();
  const generate = options.generateSuffix ?? generateDeploymentSuffix;

  if (requestedName != undefined) {
    const resolved = resolveDeploymentName({ componentName: LYNX_DASH_COMPONENT_NAME, requestedName, store });
    if (locks != undefined) {
      // Held for the same reason; whether it was free does not change the name the user asked for.
      await claim(locks, resolved.name);
    }
    return { name: resolved.name, deploymentStore: store, persistent: true };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const resolved = resolveDeploymentName({ componentName: LYNX_DASH_COMPONENT_NAME, store, generateSuffix: generate });
    if (locks == undefined || (await claim(locks, resolved.name))) {
      return { name: resolved.name, deploymentStore: store, persistent: resolved.persistent };
    }
    // Another tab holds this name: forget it, so the next resolution generates a fresh one.
    store.set(deploymentStorageKey(LYNX_DASH_COMPONENT_NAME), "");
  }

  // Unreachable in practice (eight fresh random names all taken); fall back to a one-off name.
  return { name: defaultDeploymentName(LYNX_DASH_COMPONENT_NAME, generate()), deploymentStore: store, persistent: false };
}
