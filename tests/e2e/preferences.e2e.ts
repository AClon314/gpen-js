import { expect, test, type Page } from "playwright/test";

/**
 * T8 回归：偏好设置面板（浮动）+ 主题三态 + 偏好持久化。
 */
async function openWorkspace(page: Page) {
  await expect(page.locator(".blender-panel-menu, .floating-button").first()).toBeVisible();
  if (await page.locator(".floating-button").isVisible()) {
    await page.locator(".floating-button").click();
  }
  await expect(page.locator(".blender-panel-menu")).toBeVisible();
}

async function openPreferences(page: Page) {
  await page.keyboard.press("Control+Alt+u");
  await expect(page.locator(".blender-panel-preferences")).toBeVisible();
}

function themeAttribute(page: Page) {
  return page.evaluate(() => document.documentElement.getAttribute("data-gpen-theme"));
}

/** Size in bytes of the stored `gpen-main` binary (0 before the first save). */
function documentSize(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gpen-storage");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = db.transaction("kv", "readonly").objectStore("kv").get("gpen-root");
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const gpen = (value?.gpen ?? {}) as Record<string, { size?: number }>;
    return gpen["gpen-main"]?.size ?? 0;
  });
}

/** Non-transparent pixels on the stroke canvas. */
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

test.describe("preferences panel", () => {
  test("opens as a floating dockview panel and does not duplicate", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    await openPreferences(page);

    // 浮动组：面板不在网格里，而在 `.dv-floating` 容器中。
    // dockview 8.2 给浮动组的类是 `.dv-groupview-floating`（没有 `.dv-floating` 容器）。
    await expect(page.locator(".dv-groupview-floating")).toHaveCount(1);
    expect(await page.locator(".blender-panel-preferences").count()).toBe(1);

    // 幂等：再按一次快捷键不开第二个。
    await page.keyboard.press("Control+Alt+u");
    await page.waitForTimeout(300);
    expect(await page.locator(".blender-panel-preferences").count()).toBe(1);
    // dockview 8.2 给浮动组的类是 `.dv-groupview-floating`（没有 `.dv-floating` 容器）。
    await expect(page.locator(".dv-groupview-floating")).toHaveCount(1);
  });

  test("switches the theme tri-state and applies it immediately", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    await openPreferences(page);

    const theme = page.getByLabel("主题");
    expect(await theme.inputValue()).toBe("system");
    // `system` 不写属性（由静态 CSS 的 `color-scheme: light dark` 决定）。
    expect(await themeAttribute(page)).toBeNull();

    await theme.selectOption("dark");
    await expect.poll(() => themeAttribute(page)).toBe("dark");
    const darkBg = await page.evaluate(
      () => getComputedStyle(document.querySelector(".blender-panel-preferences")!).backgroundColor,
    );

    await theme.selectOption("light");
    await expect.poll(() => themeAttribute(page)).toBe("light");
    const lightBg = await page.evaluate(
      () => getComputedStyle(document.querySelector(".blender-panel-preferences")!).backgroundColor,
    );
    expect(darkBg).not.toBe(lightBg);

    await theme.selectOption("system");
    await expect.poll(() => themeAttribute(page)).toBeNull();
  });

  test("keeps the preference after a reload", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await openWorkspace(page);
    await openPreferences(page);
    await page.getByLabel("主题").selectOption("dark");
    await expect.poll(() => themeAttribute(page)).toBe("dark");
    // 偏好是 debounce 落盘的（KV），给存储一点时间。
    await page.waitForTimeout(1500);

    await page.reload();
    await openWorkspace(page);
    await expect.poll(() => themeAttribute(page), { timeout: 15_000 }).toBe("dark");
    await openPreferences(page);
    expect(await page.getByLabel("主题").inputValue()).toBe("dark");
  });

  test("shows brush and eraser settings from the protocol toolbar state", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    await openPreferences(page);

    // 擦除模式是协议 `EraserMode`（3 个值），默认 HARD（1）。
    const mode = page.getByLabel("擦除模式");
    await expect(mode.locator("option")).toHaveCount(3);
    expect(await mode.inputValue()).toBe("1");
    await expect(mode.locator("option", { hasText: "笔画（整笔删除）" })).toHaveCount(1);

    // 画笔颜色是 SWC 取色器，默认取浅色主题的 accent（#4f46e5）。
    const color = page.locator("[data-color-picker] sp-color-field");
    await expect(color).toHaveCount(1);
  });

  test("toggling the status bar from the 切换 menu really removes the panel", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    await expect(page.locator(".blender-panel-statusbar")).toHaveCount(1);

    await page.getByRole("button", { name: "切换菜单" }).click();
    await page.getByRole("menuitem", { name: "显示状态栏" }).click();
    await expect(page.locator(".blender-panel-statusbar")).toHaveCount(0);

    // 重新加回来时高度必须按默认布局重建（否则回到 dockview 的 100px 组最小值）。
    await page.getByRole("button", { name: "切换菜单" }).click();
    await page.getByRole("menuitem", { name: "显示状态栏" }).click();
    await expect(page.locator(".blender-panel-statusbar")).toHaveCount(1);
    const height = await page
      .locator(".blender-panel-statusbar")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeLessThan(60);
  });

  test("opening the panel does not write the document", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await openWorkspace(page);
    await expect.poll(() => documentSize(page), { timeout: 25_000 }).toBeGreaterThan(0);

    // 先画一笔：toolbarState 这时才真正存在于文档里，所以「打开面板」的
    // 副作用会表现为文档字节数变化。
    const box = await page.locator("canvas.stroke-surface").boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => documentSize(page), { timeout: 15_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    const before = await documentSize(page);

    await openPreferences(page);
    // 面板里的滑条 / 取色器会把自己的值回发一次（InputSlider 在 `$effect` 里发
    // `onvalidvalue`）。若回退值不是协议默认值（例如 size 回退成 0 被 min=1 钳住），
    // 这一次回发就会把默认 toolbarState 写进文档。所以「打开面板」必须零副作用。
    await page.waitForTimeout(2500);
    expect(await documentSize(page)).toBe(before);

    // 而且不能凭空多出一条 undo（那说明写了一次“等值但重建”的文档）。
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(400);
    await expect.poll(() => countInk(page)).toBe(0);
  });

  test("reset restores the default preferences", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    await openPreferences(page);
    await page.getByLabel("主题").selectOption("dark");
    await expect.poll(() => themeAttribute(page)).toBe("dark");

    await page.getByRole("button", { name: "恢复默认偏好" }).click();
    await expect.poll(() => themeAttribute(page)).toBeNull();
    expect(await page.getByLabel("主题").inputValue()).toBe("system");
  });
});
