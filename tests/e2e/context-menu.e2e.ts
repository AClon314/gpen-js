import { expect, test } from "playwright/test";

/**
 * 上下文菜单回归：键盘导航（↑↓/Home/End、跳过禁用项与分隔项）、子菜单展开/返回、
 * `when` 可见性与主题 token 配色。
 *
 * 菜单挂在 body 上的单例组件里（`+layout.svelte`），所以这里只驱动
 * `/demo/menu` 这个活体示例页。
 */
test.describe("context menu", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/menu");
  });

  test("opens on right click and focuses the first enabled item", async ({ page }) => {
    await page.getByTestId("menu-target").click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "绘制笔画" })).toBeFocused();
  });

  test("moves focus with ArrowUp/ArrowDown and skips disabled items", async ({ page }) => {
    await page.getByTestId("menu-target").click({ button: "right" });
    const draw = page.getByRole("menuitem", { name: "绘制笔画" });
    const duplicate = page.getByRole("menuitem", { name: "复制图层" });
    const brush = page.getByRole("menuitem", { name: "画笔" });

    await expect(draw).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(duplicate).toBeFocused();
    // 「锁定图层」是禁用项：ArrowDown 必须跳过它。
    await page.keyboard.press("ArrowDown");
    await expect(brush).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(duplicate).toBeFocused();
  });

  test("Home and End jump to the first and last enabled items", async ({ page }) => {
    await page.getByTestId("menu-target").click({ button: "right" });
    // 菜单打开后的首次聚焦是异步的（等一帧布局再夹取/聚焦）：先等它落定，
    // 否则按键可能落在 body 上。
    await expect(page.getByRole("menuitem", { name: "绘制笔画" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "高级选项（when 示例）" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("menuitem", { name: "绘制笔画" })).toBeFocused();
  });

  test("ArrowRight opens nested submenus and ArrowLeft walks back", async ({ page }) => {
    await page.getByTestId("menu-target").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "绘制笔画" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "画笔" })).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menuitem", { name: "尺寸 +10" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "硬度" })).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menuitem", { name: "柔边" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("menuitem", { name: "硬度" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("menuitem", { name: "画笔" })).toBeFocused();
  });

  test("flips a deep submenu back inside a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 420 });
    await page.getByTestId("menu-target").click({ button: "right", position: { x: 200, y: 40 } });
    await expect(page.getByRole("menuitem", { name: "绘制笔画" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "画笔" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menuitem", { name: "尺寸 +10" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "硬度" })).toBeFocused();
    await page.keyboard.press("ArrowRight");

    const leaf = page.getByRole("menuitem", { name: "柔边", exact: true });
    await expect(leaf).toBeFocused();
    const box = await leaf.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(520);
  });

  test("runs the command and closes the menu", async ({ page }) => {
    await page.getByTestId("menu-target").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "绘制笔画" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("menu-result")).toHaveText("最后执行的命令：demo.draw");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("hides items whose when predicate is false", async ({ page }) => {
    await page.getByRole("checkbox").uncheck();
    await page.getByTestId("menu-target").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "高级选项（when 示例）" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "绘制笔画" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "画笔" })).toBeFocused();
  });

  test("paints with theme tokens in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await page.getByTestId("menu-target").click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();

    const colors = await page.evaluate(() => {
      const menu = document.querySelector("[data-context-menu-root]");
      const probe = document.createElement("div");
      probe.style.background = "var(--gpen-panel-background)";
      document.body.append(probe);
      const tokenBackground = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { menu: getComputedStyle(menu!).backgroundColor, tokenBackground };
    });
    // 菜单表面必须来自 token，而不是写死的浅色。
    expect(colors.tokenBackground).not.toBe("rgb(255, 255, 255)");
    expect(colors.menu).toBe(colors.tokenBackground);
  });
});
