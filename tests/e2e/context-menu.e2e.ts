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

  test("opens the window menu anchored to its menu-bar button", async ({ page }) => {
    await page.goto("/");
    await page.locator(".floating-button").click();
    const button = page.getByRole("button", { name: "窗口菜单" });
    await expect(button).toBeVisible();

    const anchor = await button.boundingBox();
    await button.click();
    const item = page.getByRole("menuitem", { name: "重置面板布局" });
    await expect(item).toBeVisible();

    // 锚定：菜单在按钮下方，且左边缘对齐按钮（不是鼠标位置）。
    const menu = await page.locator("[data-context-menu-root]").boundingBox();
    expect(menu).not.toBeNull();
    expect(menu!.y).toBeGreaterThanOrEqual(anchor!.y + anchor!.height - 1);
    expect(Math.abs(menu!.x - anchor!.x)).toBeLessThan(24);

    // 同一次点击不能把刚开的菜单关掉（click 冒泡到 window 的关闭监听）。
    await expect(item).toBeVisible();

    // 点菜单项执行命令并关闭。
    await item.click();
    await expect(page.getByRole("menuitem", { name: "重置面板布局" })).toHaveCount(0);

    // 再点按钮可以重新打开（不是 <select> 那种“选完复位”）。
    await button.click();
    await expect(page.getByRole("menuitem", { name: "重置面板布局" })).toBeVisible();
  });

  test("menu-bar buttons are not long-press targets", async ({ page }) => {
    // 菜单栏按钮走的是「点一下开菜单」（`openAt`）。如果它们被当成触屏长按目标，
    // 按住 500ms 的定时器会吃掉浏览器自己的 click（`touchend.preventDefault()`），
    // 而菜单行在窄屏上又是可横向滚的——按住拖动本该只是滚动，不应该弹菜单。
    await page.goto("/");
    await page.locator(".floating-button").click();
    const button = page.getByRole("button", { name: "文件菜单", exact: true });
    await expect(button).toBeVisible();

    // 合成一次「按住 700ms」：超过了长按阈值。行为断言在前——真正要保的是
    // 「按住不该弹菜单」，属性只是它当下的实现方式。
    const box = (await button.boundingBox())!;
    await button.evaluate((node) => {
      const touch = new Touch({
        identifier: 1,
        target: node,
        clientX: node.getBoundingClientRect().x + 4,
        clientY: node.getBoundingClientRect().y + 4,
      });
      node.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
        }),
      );
    });
    await page.waitForTimeout(700);
    await expect(page.getByRole("menu")).toHaveCount(0);

    // 抬手后的 click 照常开菜单（不会被吞掉），而且是锚定在按钮上的。
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole("menu")).toBeVisible();
    const menu = (await page.locator("[data-context-menu-root]").boundingBox())!;
    expect(Math.abs(menu.x - box.x)).toBeLessThan(24);

    // 机制备注：豁免是挂在按钮上的属性（`contextMenu.svelte.ts` 读到就跳过长按定时器）。
    await expect(button).toHaveAttribute("data-context-menu-touch-opt-out", "");
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
