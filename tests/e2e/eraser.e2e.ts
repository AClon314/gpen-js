import { expect, test, type Page } from "playwright/test";

import { openWorkspace } from "./helpers/workspace";

/**
 * T10 / T11 回归：画笔参数落进协议 `ToolbarState`，橡皮按 `mode` 擦除。
 *
 * 三种擦除模式是 Blender 的真实语义（与枚举名相反，见 handoff §3）：
 * STROKE = 整笔删除、SOFT = 逐点降 opacity、HARD = 切开笔画。
 */

function countInk(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.stroke-surface");
    if (!canvas) return -1;
    const context = canvas.getContext("2d");
    if (!context) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] > 0) count += 1;
    return count;
  });
}

/**
 * Total alpha over the whole canvas ("ink mass").
 *
 * The discriminator between SOFT and STROKE/HARD: SOFT lowers `Point.opacity`, so
 * the mass drops while the number of inked pixels barely changes; the other two
 * remove geometry, so the pixel count itself drops.
 */
function inkMass(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.stroke-surface");
    if (!canvas) return -1;
    const context = canvas.getContext("2d");
    if (!context) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let mass = 0;
    for (let index = 3; index < data.length; index += 4) mass += data[index];
    return mass;
  });
}

/** Make the eraser big enough that a short drag really bites into a 2px line. */
async function setEraserSize(page: Page, diameter: number) {
  await openPreferences(page);
  await preferences(page).getByLabel("橡皮尺寸（直径）").fill(String(diameter));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

/** Draw one straight stroke from a relative start to a relative end. */
async function drawLine(page: Page, from: [number, number], to: [number, number]) {
  const box = await page.locator("canvas.stroke-surface").boundingBox();
  expect(box).not.toBeNull();
  const x = (t: number) => box!.x + box!.width * t;
  const y = (t: number) => box!.y + box!.height * t;
  await page.mouse.move(x(from[0]), y(from[1]));
  await page.mouse.down();
  await page.mouse.move(x((from[0] + to[0]) / 2), y((from[1] + to[1]) / 2), { steps: 6 });
  await page.mouse.move(x(to[0]), y(to[1]), { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Drag the eraser across the same path (the canvas reports layer-local points). */
async function eraseAlong(page: Page, from: [number, number], to: [number, number]) {
  const box = await page.locator("canvas.stroke-surface").boundingBox();
  const x = (t: number) => box!.x + box!.width * t;
  const y = (t: number) => box!.y + box!.height * t;
  await page.mouse.move(x(from[0]), y(from[1]));
  await page.mouse.down();
  await page.mouse.move(x((from[0] + to[0]) / 2), y((from[1] + to[1]) / 2), { steps: 8 });
  await page.mouse.move(x(to[0]), y(to[1]), { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function selectTool(page: Page, label: string) {
  await page.locator(`.tool-buttons button[aria-label='${label}']`).click();
  await page.waitForTimeout(150);
}

async function setEraserMode(page: Page, label: string) {
  await preferences(page).getByLabel("擦除模式").selectOption({ label });
  await page.waitForTimeout(150);
}

async function openPreferences(page: Page) {
  await page.keyboard.press("Control+Alt+u");
  await expect(page.locator(".blender-panel-preferences")).toBeVisible();
}

/** 属性面板与设置面板共用同一批 `aria-label`，所以查值要限定作用域。 */
function preferences(page: Page) {
  return page.locator(".blender-panel-preferences");
}

/** `Gpen.toolbarState.brush` / `.eraser` as stored in the document (via the KV blob). */
function readToolbarStateFromStorage(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gpen-storage");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = db.transaction("kv", "readonly").objectStore("kv").get("gpen-root");
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const gpen = (record?.gpen ?? {}) as Record<string, { size?: number }>;
    return gpen["gpen-main"]?.size ?? 0;
  });
}

test.describe("brush and eraser", () => {
  test("a thicker brush writes bigger point radii into the document", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await openWorkspace(page, { canvas: true });

    // 默认画笔直径 4 → 半径 2。把直径调到 40 再画，落盘的字节数应当更大，
    // 并且像素更多（等长笔画、更粗的线）。
    await drawLine(page, [0.3, 0.3], [0.6, 0.3]);
    const thinInk = await countInk(page);
    expect(thinInk).toBeGreaterThan(0);

    await openPreferences(page);
    await preferences(page).getByLabel("画笔尺寸（直径）").fill("40");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    // 关掉浮动面板，免得挡住画布。
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    await drawLine(page, [0.3, 0.6], [0.6, 0.6]);
    const thickInk = (await countInk(page)) - thinInk;
    expect(thickInk).toBeGreaterThan(thinInk);
  });

  test("STROKE mode erases a whole stroke and Ctrl+Z brings it back", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page, { canvas: true });
    await openPreferences(page);
    await setEraserMode(page, "笔画（整笔删除）");
    await page.keyboard.press("Escape");

    await drawLine(page, [0.3, 0.3], [0.6, 0.3]);
    await drawLine(page, [0.3, 0.6], [0.6, 0.6]);
    const both = await countInk(page);
    expect(both).toBeGreaterThan(0);

    await selectTool(page, "橡皮");
    // 只擦第一条：第二条整笔应当还在。
    await eraseAlong(page, [0.3, 0.3], [0.6, 0.3]);
    const afterErase = await countInk(page);
    expect(afterErase).toBeLessThan(both);
    expect(afterErase).toBeGreaterThan(0);

    // 一次 Ctrl+Z 退回整次拖动（橡皮拖动被 coalesce 成一条 undo）。
    await page.keyboard.press("Control+z");
    await expect.poll(() => countInk(page)).toBe(both);
  });

  /**
   * 两次**独立**橡皮拖动 = 两条 undo（`eraseGestureStart` 回归）。
   *
   * 预存在问题：`eraseGestureStart` 只赋不清，第二次拖动继续用第一次的 coalesce 目标，
   * 于是 Ctrl+Z 一次把两次拖动都退回。修法是在手势边界（pointerup / cancel）清掉它，
   * 见 `gpenDocumentSession.svelte.ts` 的 `endEraseGesture()`。
   */
  test("two separate eraser drags are two undo steps", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page, { canvas: true });
    await openPreferences(page);
    await setEraserMode(page, "笔画（整笔删除）");
    await page.keyboard.press("Escape");

    await drawLine(page, [0.3, 0.3], [0.6, 0.3]);
    await drawLine(page, [0.3, 0.6], [0.6, 0.6]);
    const both = await countInk(page);
    expect(both).toBeGreaterThan(0);

    await selectTool(page, "橡皮");
    await eraseAlong(page, [0.3, 0.3], [0.6, 0.3]);
    const afterFirst = await countInk(page);
    expect(afterFirst).toBeLessThan(both);

    await eraseAlong(page, [0.3, 0.6], [0.6, 0.6]);
    const afterSecond = await countInk(page);
    expect(afterSecond).toBeLessThan(afterFirst);

    // 第一次 Ctrl+Z 只退回第二次拖动（回归时一次就退回两条）。
    await page.keyboard.press("Control+z");
    await expect.poll(() => countInk(page)).toBe(afterFirst);
    // 第二次 Ctrl+Z 退回第一次拖动。
    await page.keyboard.press("Control+z");
    await expect.poll(() => countInk(page)).toBe(both);
  });

  test("SOFT mode dims the stroke instead of deleting it", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page, { canvas: true });
    await openPreferences(page);
    await setEraserMode(page, "溶解（逐点降不透明度）");
    await page.keyboard.press("Escape");

    await drawLine(page, [0.3, 0.4], [0.6, 0.4]);
    const ink = await countInk(page);
    const mass = await inkMass(page);
    expect(ink).toBeGreaterThan(0);

    await selectTool(page, "橡皮");
    await eraseAlong(page, [0.35, 0.4], [0.55, 0.4]);
    // 溶解是「变淡」：墨量（alpha 总和）明显下降，但笔画没被删掉——
    // 像素数基本不变（这才是与 STROKE/HARD 的区别）。
    expect(await inkMass(page)).toBeLessThan(mass);
    expect(await countInk(page)).toBeGreaterThan(ink * 0.9);
  });

  test("HARD mode cuts a stroke into two pieces", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page, { canvas: true });
    await openPreferences(page);
    await setEraserMode(page, "点（切开笔画）");
    await page.keyboard.press("Escape");
    // 大橡皮：HARD 是「折线与圆求交」，橡皮太小只会削掉线的边缘像素。
    await setEraserSize(page, 160);

    // 一条长横线，从中间擦一刀：两端应当都还在，中间缺一块。
    await drawLine(page, [0.15, 0.5], [0.85, 0.5]);
    const ink = await countInk(page);
    expect(ink).toBeGreaterThan(0);

    await selectTool(page, "橡皮");
    // 垂直于笔画擦一刀（横向拖过整条线），保证圆真的把线切开。
    await eraseAlong(page, [0.5, 0.3], [0.5, 0.7]);
    const after = await countInk(page);
    // 中间被切掉（像素明显变少），但两端的墨迹还在。
    expect(after).toBeLessThan(ink * 0.9);
    expect(after).toBeGreaterThan(0);
  });

  test("the toolbar state is persisted with the document", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await openWorkspace(page, { canvas: true });
    await expect
      .poll(() => readToolbarStateFromStorage(page), { timeout: 25_000 })
      .toBeGreaterThan(0);
    const before = await readToolbarStateFromStorage(page);

    await openPreferences(page);
    await preferences(page).getByLabel("画笔尺寸（直径）").fill("48");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    await page.keyboard.press("Escape");

    // 设置写进文档 → debounce 落盘 → 二进制变大。
    await expect
      .poll(() => readToolbarStateFromStorage(page), { timeout: 15_000 })
      .toBeGreaterThan(before);
  });
});

test.describe("properties panel", () => {
  test("follows the active tool and writes the same protocol state", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await openWorkspace(page, { canvas: true });

    const properties = page.locator(".blender-panel-properties");
    await expect(properties.getByText("笔刷设置")).toBeVisible();
    // 画笔模式：有「间距」，尺寸滑条标「画笔直径」。
    await expect(properties.getByLabel("画笔尺寸（直径）")).toBeVisible();
    await expect(properties.getByLabel("画笔间距")).toBeVisible();

    await selectTool(page, "橡皮");
    await expect(properties.getByText("橡皮设置")).toBeVisible();
    await expect(properties.getByLabel("橡皮尺寸（直径）")).toBeVisible();
    await expect(properties.getByLabel("橡皮强度")).toBeVisible();
    // 橡皮没有「间距」。
    await expect(properties.getByLabel("画笔间距")).toHaveCount(0);

    // 属性面板改的是**同一份** `ToolbarState`：设置面板能看到同一个值。
    await properties.getByLabel("橡皮尺寸（直径）").fill("64");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    // 焦点还在文本框里时快捷键会被让给控件（`isTextEntryTarget`），先点开空白处。
    await properties.getByText("橡皮设置").click();
    await openPreferences(page);
    expect(await preferences(page).getByLabel("橡皮尺寸（直径）").inputValue()).toBe("64");
  });
});
