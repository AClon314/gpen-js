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
