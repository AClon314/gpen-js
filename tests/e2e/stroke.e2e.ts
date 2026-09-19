import { expect, test, type Page } from "playwright/test";

/**
 * T4 回归：stroke 最小写入路径。
 *
 * 覆盖「画一笔 → 画布有像素 → undo → 像素消失 → 落盘 → reload → 笔画还在」。
 * 打开工作区 = 绘制模式：视口洞被 `canvas.stroke-surface` 接管（见 docs/stroke.md），
 * 宿主网页的交互交还给「最小化」（tests/embed/embed.e2e.ts）。
 */
async function openWorkspace(page: Page) {
  // 重载后 `open` 是持久化偏好，工作区可能已经自己打开了；也可能还没渲染完。
  // 先等「菜单栏或悬浮球」任一出现，再决定要不要点开。
  await expect(page.locator(".blender-panel-menu, .floating-button").first()).toBeVisible();
  if (await page.locator(".floating-button").isVisible()) {
    await page.locator(".floating-button").click();
  }
  await expect(page.locator(".blender-panel-menu")).toBeVisible();
  await expect(page.locator("canvas.stroke-surface")).toBeVisible();
}

/** Count non-transparent pixels in the stroke canvas backing store. */
function countInkPixels(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.stroke-surface");
    if (!canvas) return -1;
    const context = canvas.getContext("2d");
    if (!context) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) count += 1;
    }
    return count;
  });
}

/** Draw a short diagonal stroke through the middle of the canvas. */
async function drawStroke(page: Page) {
  const box = await page.locator("canvas.stroke-surface").boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.3;
  const startY = box!.y + box!.height * 0.3;
  const endX = box!.x + box!.width * 0.6;
  const endY = box!.y + box!.height * 0.5;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 8 });
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();
}

/** `gpen-main` metadata in the runtime KV (IndexedDB), or null before it exists. */
function readMetadata(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gpen-storage");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains("kv")) {
      db.close();
      return null;
    }
    const value = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = db.transaction("kv", "readonly").objectStore("kv").get("gpen-root");
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const gpen = (value?.gpen ?? {}) as Record<string, { size?: number; updated_at?: string }>;
    const entry = gpen["gpen-main"];
    return entry ? { size: entry.size ?? 0, updatedAt: entry.updated_at ?? "" } : null;
  });
}

test.describe("stroke write path", () => {
  test("draws ink and Ctrl+Z removes it (Ctrl+Shift+Z restores it)", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    expect(await countInkPixels(page)).toBe(0);

    await drawStroke(page);
    await expect.poll(() => countInkPixels(page)).toBeGreaterThan(0);

    await page.keyboard.press("Control+z");
    await expect.poll(() => countInkPixels(page)).toBe(0);

    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() => countInkPixels(page)).toBeGreaterThan(0);
  });

  test("persists a stroke through gpenBinary and restores it after reload", async ({ page }) => {
    // 首次 Blob 写入会先试 OPFS broker（`https://xxx.github.com/storage-broker`，占位域
    // 在此环境不可达）：penpal 握手超时 10s 后才回落到当前 origin 的 IndexedDB，
    // 之后同一页面复用回落结果（见 docs/storage.md）。所以第一次读 / 写要等得久一点。
    test.setTimeout(90_000);
    await page.goto("/");
    await openWorkspace(page);

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
    await openWorkspace(page);
    // Reload re-selects the blob backend from scratch: same ~10s broker timeout, then
    // the stored document is loaded and the stroke is repainted.
    await expect.poll(() => countInkPixels(page), { timeout: 25_000 }).toBeGreaterThan(0);
  });
});
