// SPDX-License-Identifier: MPL-2.0

import { LYNX_DASH_COMPONENT_NAME, claimDashDeployment, type LockManagerLike } from "./lynxIdentity";

function memoryStorage(initial: Record<string, string> = {}): {
  data: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

/** One browser's Web Locks: a name held by any tab stays held for the life of the browser. */
function sharedLocks(): LockManagerLike & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    request: async (name, options, callback) => {
      if (held.has(name)) {
        return await callback(null);
      }
      held.add(name);
      void options;
      return await callback({});
    },
  };
}

const STORAGE_KEY = "lynx:deployment:lynxDash";

describe("claimDashDeployment", () => {
  it("generates a lynxDash-xxxxxxxx name and remembers it for the tab", async () => {
    const storage = memoryStorage();
    const claimed = await claimDashDeployment({ storage, locks: sharedLocks() });
    expect(claimed.name).toMatch(/^lynxDash-[0-9a-f]{8}$/);
    expect(claimed.persistent).toBe(true);
    expect(storage.data[STORAGE_KEY]).toBe(claimed.name.slice(LYNX_DASH_COMPONENT_NAME.length + 1));
  });

  it("keeps the same name across a reload of the tab", async () => {
    const storage = memoryStorage();
    const first = await claimDashDeployment({ storage, locks: sharedLocks() });
    // A reload: same sessionStorage, and the old page's locks are gone.
    const second = await claimDashDeployment({ storage, locks: sharedLocks() });
    expect(second.name).toBe(first.name);
  });

  it("gives two different tabs different names", async () => {
    const locks = sharedLocks();
    const a = await claimDashDeployment({ storage: memoryStorage(), locks });
    const b = await claimDashDeployment({ storage: memoryStorage(), locks });
    expect(a.name).not.toBe(b.name);
  });

  it("gives a duplicated tab a new name instead of the one it inherited", async () => {
    const locks = sharedLocks();
    const original = memoryStorage();
    const first = await claimDashDeployment({ storage: original, locks });

    // "Duplicate tab" copies sessionStorage, but the original tab is still alive and holds the name.
    const copy = memoryStorage({ ...original.data });
    const second = await claimDashDeployment({ storage: copy, locks });
    expect(second.name).not.toBe(first.name);
    expect(second.name).toMatch(/^lynxDash-[0-9a-f]{8}$/);
    // The copy remembers its own name; the original keeps its.
    expect(copy.data[STORAGE_KEY]).toBe(second.name.slice(LYNX_DASH_COMPONENT_NAME.length + 1));
    expect(original.data[STORAGE_KEY]).toBe(first.name.slice(LYNX_DASH_COMPONENT_NAME.length + 1));
  });

  it("uses the name the user chose, unchanged", async () => {
    const claimed = await claimDashDeployment({ requestedName: "  benchLaptop  ", storage: memoryStorage(), locks: sharedLocks() });
    expect(claimed.name).toBe("benchLaptop");
  });

  it("treats a blank chosen name as none", async () => {
    const claimed = await claimDashDeployment({ requestedName: "   ", storage: memoryStorage(), locks: sharedLocks() });
    expect(claimed.name).toMatch(/^lynxDash-[0-9a-f]{8}$/);
  });

  it("rejects a chosen name that cannot be a topic segment", async () => {
    await expect(claimDashDeployment({ requestedName: "a/b", storage: memoryStorage(), locks: sharedLocks() })).rejects.toThrow();
  });

  it("still works without storage or Web Locks, but the name will not survive a reload", async () => {
    const claimed = await claimDashDeployment({ locks: undefined });
    expect(claimed.name).toMatch(/^lynxDash-[0-9a-f]{8}$/);
    expect(claimed.persistent).toBe(false);
  });

  it("falls back to a one-off name if every generated name is taken", async () => {
    const refuse: LockManagerLike = { request: async (_name, _options, callback) => await callback(null) };
    const claimed = await claimDashDeployment({ storage: memoryStorage(), locks: refuse });
    expect(claimed.name).toMatch(/^lynxDash-[0-9a-f]{8}$/);
    expect(claimed.persistent).toBe(false);
  });

  it("does not hold a lock for a name it did not use", async () => {
    const locks = sharedLocks();
    const original = memoryStorage();
    await claimDashDeployment({ storage: original, locks });
    const before = locks.held.size;
    await claimDashDeployment({ storage: memoryStorage({ ...original.data }), locks });
    // The duplicate probed the inherited name (already held) and claimed exactly one new one.
    expect(locks.held.size).toBe(before + 1);
  });
});
