// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";

/**
 * Lynx Dash against a real Lynx network. Skipped unless a broker is given:
 *
 *   LYNX_E2E_BROKER=ws://localhost:9001 yarn test:e2e:web
 *
 * The network needs at least one Service with a Channel that can stream (for example
 * `slicesCore`). `LYNX_E2E_CHANNEL` picks the Channel row by a fragment of its name; the first
 * Channel is used otherwise. `LYNX_E2E_URL` points the test at an already-served build.
 */
const BROKER = process.env.LYNX_E2E_BROKER;
const CHANNEL = process.env.LYNX_E2E_CHANNEL;
const APP_URL = process.env.LYNX_E2E_URL ?? "/";

test.describe("Lynx network", () => {
  test.skip(BROKER == undefined, "set LYNX_E2E_BROKER to a broker WebSocket URL to run against a Lynx network");

  test("connects under its own per-tab name and lists the network", async ({ page }) => {
    await page.goto(`${APP_URL}?ds=lynx&ds.url=${encodeURIComponent(BROKER!)}`);
    await expect(page.getByText(/Lynx \(lynxDash-[0-9a-f]{8}\)/)).toBeVisible({ timeout: 20_000 });

    await page.getByText("Lynx Network", { exact: true }).first().click();
    const rows = page.locator('[role="treeitem"]');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    // Channels show their state next to the deployed name.
    await expect(page.locator('[role="treeitem"]', { hasText: "(idle)" }).first()).toBeVisible();
  });

  test("two tabs get two different identities", async ({ browser }) => {
    const names: string[] = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${APP_URL}?ds=lynx&ds.url=${encodeURIComponent(BROKER!)}`);
      const title = page.getByText(/Lynx \(lynxDash-[0-9a-f]{8}\)/);
      await expect(title).toBeVisible({ timeout: 20_000 });
      names.push((await title.innerText()).replace(/\s+/g, ""));
      await context.close();
    }
    expect(new Set(names).size).toBe(2);
  });

  test("starts and stops a Stream from the Channel's detail panel", async ({ page }) => {
    await page.goto(`${APP_URL}?ds=lynx&ds.url=${encodeURIComponent(BROKER!)}`);
    await page.getByText("Lynx Network", { exact: true }).first().click();

    const channelRows = page.locator('[role="treeitem"]', { hasText: CHANNEL ?? "(idle)" });
    await expect(channelRows.first()).toBeVisible({ timeout: 20_000 });
    const row = channelRows.first();
    await row.click();

    // Only the settings this Channel's Stream schema lists are offered.
    await expect(page.getByLabel("Sample interval (s)")).toBeVisible();

    await page.getByRole("button", { name: "Start stream" }).click();
    await expect(row).toContainText("streaming", { timeout: 10_000 });
    await expect(page.getByText(/Streaming, started by this dash/)).toBeVisible();

    await page.getByRole("button", { name: "Stop stream" }).click();
    await expect(row).toContainText("idle", { timeout: 10_000 });
  });

  test("an invalid stream setting is refused before anything is sent", async ({ page }) => {
    await page.goto(`${APP_URL}?ds=lynx&ds.url=${encodeURIComponent(BROKER!)}`);
    await page.getByText("Lynx Network", { exact: true }).first().click();
    const row = page.locator('[role="treeitem"]', { hasText: CHANNEL ?? "(idle)" }).first();
    await row.click();

    await page.getByLabel("Sample interval (s)").fill("-1");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Must be at least 0")).toBeVisible();
  });
});
