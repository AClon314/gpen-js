import { expect, test, type Page } from "playwright/test";

import { readKvRecord } from "./helpers/storage";

/**
 * T5 回归：工作区偏好不再走 localStorage，而是 `createRuntimeStorage()` 的 KV
 * （网页里 = IndexedDB），并且旧 localStorage 记录会被迁移。
 */
async function readStoredUiScale(page: Page): Promise<number | undefined> {
  const value = (await readKvRecord(page, "root")) as
    | { workspace?: { uiScale?: number } }
    | undefined;
  return value?.workspace?.uiScale;
}

test.describe("workspace state persistence", () => {
  test("keeps the ui scale across a reload through the runtime KV", async ({ page }) => {
    await page.goto("/");
    await page.locator(".floating-button").click();
    await expect(page.locator(".blender-panel-menu")).toBeVisible();

    await page.getByLabel("放大界面").click();
    await page.getByLabel("放大界面").click();
    await expect(page.locator(".ui-scale-value")).toHaveText("1.50×");

    // Wait for the async KV write before reloading.
    await expect.poll(() => readStoredUiScale(page)).toBe(1.5);

    await page.reload();
    await expect(page.locator(".ui-scale-value")).toHaveText("1.50×");
  });

  test("migrates a legacy localStorage record on first load", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "gpen.workspaceState",
        JSON.stringify({ version: 1, open: true, activeTool: "eraser" }),
      );
      localStorage.setItem("gpen.uiScale", "1.5");
    });

    await page.goto("/");
    // `open: true` came from the migrated record, so the workspace shows up.
    await expect(page.locator(".ui-scale-value")).toHaveText("1.50×");
    await expect.poll(() => readStoredUiScale(page)).toBe(1.5);
  });
});
