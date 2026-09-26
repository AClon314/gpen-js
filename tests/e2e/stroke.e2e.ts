import { expect, test, type Page } from "playwright/test";

import { countInkPixels, dragOnCanvas } from "./helpers/canvas";
import { readKvRecord } from "./helpers/storage";
import { openWorkspace } from "./helpers/workspace";

/**
 * T4 回归：stroke 最小写入路径。
 *
 * 覆盖「画一笔 → 画布有像素 → undo → 像素消失 → 落盘 → reload → 笔画还在」。
 * 打开工作区 = 绘制模式：视口洞被 `canvas.stroke-surface` 接管（见 src/lib/layers/README-stroke.md），
 * 宿主网页的交互交还给「最小化」（tests/embed/embed.e2e.ts）。
 */

/**
 * 画一条穿过画布中部的短斜线（相对坐标 0.3,0.3 → 0.6,0.5）；
 * `offset` 给两个端点的 x 加同一段像素偏移，用来并排画多条不重叠的笔画。
 */
function drawStroke(page: Page, options: { offset?: number } = {}) {
  return dragOnCanvas(page, [0.3, 0.3], [0.6, 0.5], { steps: 8, offsetPx: options.offset ?? 0 });
}

/** `gpen-main` metadata in the runtime KV (IndexedDB), or null before it exists. */
async function readMetadata(page: Page) {
  const value = (await readKvRecord(page, "gpen-root")) as
    | Record<string, Record<string, { size?: number; updated_at?: string }>>
    | undefined;
  const entry = value?.gpen?.["gpen-main"];
  return entry ? { size: entry.size ?? 0, updatedAt: entry.updated_at ?? "" } : null;
}

test.describe("stroke write path", () => {
  test("draws ink and Ctrl+Z removes it (Ctrl+Shift+Z restores it)", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page, { canvas: true });
    expect(await countInkPixels(page)).toBe(0);

    await drawStroke(page);
    await expect.poll(() => countInkPixels(page)).toBeGreaterThan(0);

    await page.keyboard.press("Control+z");
    await expect.poll(() => countInkPixels(page)).toBe(0);

    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() => countInkPixels(page)).toBeGreaterThan(0);
  });

  test("exposes undo/redo in the status bar and keeps a deep history", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page, { canvas: true });
    const undo = page.getByLabel("撤销（Ctrl+Z）");
    const redo = page.getByLabel("重做（Ctrl+Shift+Z）");
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    // 画 3 笔：历史要能一路退回去（不是只能退一笔）。
    for (let index = 0; index < 3; index += 1) {
      await drawStroke(page, { offset: index * 40 });
    }
    await expect(undo).toBeEnabled();
    await expect(page.locator(".history-depth")).toHaveText("3");

    for (let index = 0; index < 3; index += 1) await undo.click();
    await expect.poll(() => countInkPixels(page)).toBe(0);
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();

    // 重做回来，然后新画一笔必须清掉重做分支。
    await redo.click();
    await expect.poll(() => countInkPixels(page)).toBeGreaterThan(0);
    await drawStroke(page, { offset: 160 });
    await expect(redo).toBeDisabled();
  });

  test("persists a stroke through gpenBinary and restores it after reload", async ({ page }) => {
    // 首次 Blob 写入会先试 OPFS broker（`https://xxx.github.com/storage-broker`，占位域
    // 在此环境不可达）：penpal 握手超时 10s 后才回落到当前 origin 的 IndexedDB，
    // 之后同一页面复用回落结果（见 src/lib/bindings/storage/README.md）。所以第一次读 / 写要等得久一点。
    test.setTimeout(90_000);
    await page.goto("/");
    await openWorkspace(page, { canvas: true });

    // The default document is saved as soon as the (missing) save slot settles.
    await expect.poll(() => readMetadata(page), { timeout: 25_000 }).not.toBeNull();
    const before = await readMetadata(page);
    expect(before).not.toBeNull();

    await drawStroke(page);
    await expect.poll(() => countInkPixels(page)).toBeGreaterThan(0);
    // The stroke grew the binary payload: wait for the debounced save to land.
    await expect
      .poll(async () => (await readMetadata(page))?.size ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(before!.size);

    await page.reload();
    await openWorkspace(page, { canvas: true });
    // Reload re-selects the blob backend from scratch: same ~10s broker timeout, then
    // the stored document is loaded and the stroke is repainted.
    await expect.poll(() => countInkPixels(page), { timeout: 25_000 }).toBeGreaterThan(0);
  });
});
