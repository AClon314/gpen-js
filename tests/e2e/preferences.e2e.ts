import { expect, test, type Page } from "playwright/test";

import { countInkPixels } from "./helpers/canvas";
import { openPreferences } from "./helpers/preferences";
import { readMainDocumentSize } from "./helpers/storage";
import { expectInsideViewport, gridSnapshot, openWorkspace } from "./helpers/workspace";

/**
 * T8 回归：偏好设置面板（浮动）+ 主题三态 + 偏好持久化。
 */
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

  test("opening the panel does not reflow the workspace grid", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    const before = await gridSnapshot(page);
    // 顶栏（menu 面板）与它的两行必须各自保持原高：这是用户看到的现象。
    const menuBefore = await page.locator(".menu-row").boundingBox();
    const toolSettingsBefore = await page.locator(".tool-settings").boundingBox();

    await openPreferences(page);
    await page.waitForTimeout(500);
    expect(await gridSnapshot(page)).toEqual(before);
    await expect(page.locator(".dv-groupview-floating")).toHaveCount(1);

    // 关闭（Esc 由捕获阶段收浮动面板）后再开一次：网格依然不动。
    await page.keyboard.press("Escape");
    await expect(page.locator(".blender-panel-preferences")).toHaveCount(0);
    await openPreferences(page);
    await page.waitForTimeout(500);
    expect(await gridSnapshot(page)).toEqual(before);

    const menuAfter = await page.locator(".menu-row").boundingBox();
    const toolSettingsAfter = await page.locator(".tool-settings").boundingBox();
    expect(menuAfter?.height).toBe(menuBefore?.height);
    expect(toolSettingsAfter?.height).toBe(toolSettingsBefore?.height);
  });

  /**
   * 浮窗几何：首选 420×520 且四边留 16px，装不下就夹到容器内并居中。
   *
   * 这段以前只在 `openPreferences()` 里，没有断言：消融（去掉夹取、直接把 420×520 和
   * 未夹取的居中坐标交给 dockview）能跑绿全部测试，但实测下边缘会跑到视口外。
   * `boundedWithinViewport` 只约束**用户拖动**的浮窗，不管初始请求，所以夹取是我们的责任。
   *
   * 每个尺寸一个 describe：`test.use({ viewport })` 只对 describe 生效，而且一个用例里
   * 连续换尺寸会走到「还原持久化布局」那条路（存下来的浮窗不经过 `openPreferences`），
   * 测的就不是这里要测的东西了。
   */
  for (const viewport of [
    { width: 560, height: 460 }, // 比首选尺寸矮 → 高度必须夹
    { width: 360, height: 340 }, // 比最小可用尺寸还窄 → 交给 dockview 再夹一次
  ]) {
    test.describe(`floating panel at ${viewport.width}x${viewport.height}`, () => {
      test.use({ viewport });

      test("stays inside the viewport and is centered", async ({ page }) => {
        await page.goto("/");
        await openWorkspace(page);
        await openPreferences(page);

        const panel = page.locator(".dv-groupview-floating");
        await expectInsideViewport(page, panel, "浮窗");

        // 水平居中：左右留白差不超过 1px（dockview 有自己的夹取，所以只查左右）。
        const box = (await panel.boundingBox())!;
        const left = box.x;
        const right = viewport.width - (box.x + box.width);
        expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      });
    });
  }

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
    await page.locator(".blender-panel-preferences").getByLabel("主题").selectOption("dark");
    await expect.poll(() => themeAttribute(page)).toBe("dark");
    // 偏好是 debounce 落盘的（KV），给存储一点时间。
    await page.waitForTimeout(1500);

    await page.reload();
    await openWorkspace(page);
    await expect.poll(() => themeAttribute(page), { timeout: 15_000 }).toBe("dark");
    await openPreferences(page);
    expect(await page.locator(".blender-panel-preferences").getByLabel("主题").inputValue()).toBe(
      "dark",
    );
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
    await expect.poll(() => readMainDocumentSize(page), { timeout: 25_000 }).toBeGreaterThan(0);

    // 先画一笔：toolbarState 这时才真正存在于文档里，所以「打开面板」的
    // 副作用会表现为文档字节数变化。
    const box = await page.locator("canvas.stroke-surface").boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => readMainDocumentSize(page), { timeout: 15_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    const before = await readMainDocumentSize(page);

    await openPreferences(page);
    // 面板里的滑条 / 取色器会把自己的值回发一次（InputSlider 在 `$effect` 里发
    // `onvalidvalue`）。若回退值不是协议默认值（例如 size 回退成 0 被 min=1 钳住），
    // 这一次回发就会把默认 toolbarState 写进文档。所以「打开面板」必须零副作用。
    await page.waitForTimeout(2500);
    expect(await readMainDocumentSize(page)).toBe(before);

    // 而且不能凭空多出一条 undo（那说明写了一次“等值但重建”的文档）。
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(400);
    await expect.poll(() => countInkPixels(page)).toBe(0);
  });

  test("reset restores the default preferences", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    await openPreferences(page);
    await page.locator(".blender-panel-preferences").getByLabel("主题").selectOption("dark");
    await expect.poll(() => themeAttribute(page)).toBe("dark");

    await page.getByRole("button", { name: "恢复默认偏好" }).click();
    await expect.poll(() => themeAttribute(page)).toBeNull();
    expect(await page.locator(".blender-panel-preferences").getByLabel("主题").inputValue()).toBe(
      "system",
    );
  });
});

/**
 * 浮窗在**页面滚动**时不能重落位（923 handoff §0 的回归）。
 *
 * 机制：`reclampFloatingGroups()` 挂在每帧布局末尾，而 `observeViewport` 监听 scroll →
 * 页面每滚一帧就跑一次；它原来用 `parseFloat(style.left/top)` 读位置，`bottom/right`
 * 对齐时拿到 `'auto'` → `NaN` → 误判越界 → 重落位到左上。修法：只在容器尺寸真的变了
 * 才检查，并且用 `floatingLocalBox` 把 `auto` 对齐还原成局部盒。
 */
test("keeps its position while the page scrolls (bottom-aligned float)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await openWorkspace(page);
  await openPreferences(page);

  const float = page.locator(".dv-groupview-floating");
  const overlay = page.locator(".dv-resize-container").first();
  await expect(float).toBeVisible();

  // 把浮窗拖到下半部分 → dockview 改用 bottom 对齐（`style.top = auto`）。
  const grip = (await page
    .locator(".dv-resize-container .dv-floating-titlebar")
    .first()
    .boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const alignment = await overlay.evaluate((element) => ({
    top: element.style.top,
    bottom: element.style.bottom,
  }));
  expect(alignment.top).toBe("auto");
  expect(alignment.bottom).not.toBe("auto");
  const before = (await float.boundingBox())!;

  // 在视口那一格（洞）上滚轮让页面滚动：容器尺寸不变。
  const canvas = (await page.locator("canvas.stroke-surface").boundingBox())!;
  await page.mouse.move(canvas.x + 30, canvas.y + 30);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.waitForTimeout(300);

  // 回归时浮窗会跳到左上（视觉 y 从 280 → 140），这里必须纹丝不动。
  const after = (await float.boundingBox())!;
  expect(Math.round(after.x)).toBe(Math.round(before.x));
  expect(Math.round(after.y)).toBe(Math.round(before.y));
});

/**
 * 偏好设置面板的滚动只发生在**面板这一层**（923 handoff §1）。
 *
 * 根因是 flex：面板是 `display:flex; flex-direction:column; overflow:auto`，而卡片默认
 * `flex-shrink: 1`，内容变高时 flex 先把每张卡片压扁（`overflow: hidden` 把裁切变成
 * 静默丢失），于是面板自己的 `scrollHeight` 永远不溢出、也没有滚动条。
 * 修法是 `.blender-panel-preferences > .property-card { flex: 0 0 auto }`。
 */
test("scrolls in the panel, not inside a card", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 360 });
  await page.goto("/");
  await openWorkspace(page);
  await openPreferences(page);

  const panel = page.locator(".blender-panel-preferences");
  const panelBox = await panel.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  // 内容比容器高：面板自己必须能滚（回归时两者相等 → 面板永远不滚）。
  expect(panelBox.scrollHeight).toBeGreaterThan(panelBox.clientHeight + 1);

  // 每张卡片按内容撑开，没有被裁（回归时卡片 clientHeight 77 / scrollHeight 201）。
  const clipped = await panel
    .locator(".property-card")
    .evaluateAll((cards) =>
      cards
        .filter((card) => card.scrollHeight > card.clientHeight + 1)
        .map((card) => card.querySelector("h2")?.textContent ?? "?"),
    );
  expect(clipped).toEqual([]);

  // 面板子树里不允许出现第二个显式的滚动容器（`auto` / `scroll` / `overlay`）。
  const nested = await panel.evaluate((root) => {
    const found: string[] = [];
    const walk = (element: Element) => {
      if (element !== root) {
        const overflowY = getComputedStyle(element).overflowY;
        const scrollContainer =
          overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
        if (scrollContainer && element.scrollHeight > element.clientHeight + 1) {
          found.push(element.className || element.tagName);
        }
      }
      for (const child of element.children) walk(child);
    };
    walk(root);
    return found;
  });
  expect(nested).toEqual([]);
});

/**
 * 浮窗夹回（回归 `src/lib/components/README-panel.md` 的已知缺口）：`floatingGroupBounds` 只约束**用户拖动**，
 * 容器变小（横竖屏切换 / 拖窗口）与还原布局时浮窗会按老尺寸留在原地、甚至有一半在屏外。
 * 修法见 `workspacePanelLayout.ts` 的 `reclampFloatingGroups()`：每趟布局末尾只把
 * **装不下**的浮窗重算一次落位（装得下的不碰，用户摆好的位置不会被重置）。
 */
test("comes back inside when the container shrinks, and stays put when it does not", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");
  await openWorkspace(page);
  await openPreferences(page);

  const panel = page.locator(".dv-groupview-floating");
  await expectInsideViewport(page, panel, "浮窗");
  const before = (await panel.boundingBox())!;

  // 缩小到装不下：必须夹回容器内（回归时下边缘会超出视口 159px）。
  await page.setViewportSize({ width: 420, height: 360 });
  await expect
    .poll(async () => (await panel.boundingBox())?.y, { timeout: 5_000 })
    .toBeLessThan(360);
  await expectInsideViewport(page, panel, "缩小后的浮窗");

  // 再放大：位置不重置（容器变宽不会把浮窗“归位”，那是 ① 的语义）。
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(500);
  await expectInsideViewport(page, panel, "放大后的浮窗");
  const after = (await panel.boundingBox())!;
  expect(after.width).toBeLessThanOrEqual(before.width + 1);

  // 重载（还原持久化布局）之后仍在容器内：浮窗的几何是从存储里摊回来的，
  // 走的是同一段 `reclampFloatingGroups()`。
  await page.waitForTimeout(1200);
  await page.reload();
  await openWorkspace(page);
  await expectInsideViewport(page, page.locator(".dv-groupview-floating"), "重载后的浮窗");
});

/**
 * 磨砂玻璃（可选外观，默认 0 = 关）：偏好（模糊半径 px）→ 根属性 `data-gpen-blur` + 内联
 * `--gpen-blur` + 容器 class → `themes/blur.css` 的 token / filter。这里守住：默认关、
 * 调到 8 后 chrome 真半透明 + 真模糊（半径就是 8px）、**视口那个「洞」不受影响**、
 * 调回 0 能完全回到原样。
 */
test("toggles the blur (glass) appearance without touching the viewport hole", async ({ page }) => {
  await page.goto("/");
  await openWorkspace(page);
  await openPreferences(page);

  const read = () =>
    page.evaluate(() => {
      const group = document.querySelector(".dv-groupview:not(.gpen-hole)");
      const hole = document.querySelector(".dv-groupview.gpen-hole");
      return {
        attribute: document.documentElement.getAttribute("data-gpen-blur"),
        blurRadius: document.documentElement.style.getPropertyValue("--gpen-blur"),
        containerClass: document
          .querySelector(".dockview-container")
          ?.classList.contains("gpen-blur"),
        groupFilter: group ? getComputedStyle(group).backdropFilter : null,
        groupBackground: group ? getComputedStyle(group).backgroundColor : null,
        holeFilter: hole ? getComputedStyle(hole).backdropFilter : null,
        holeBackground: hole ? getComputedStyle(hole).backgroundColor : null,
      };
    });

  const off = await read();
  expect(off.attribute).toBeNull();
  expect(off.blurRadius).toBe("");
  expect(off.groupFilter).toBe("none");
  expect(off.holeBackground).toBe("rgba(0, 0, 0, 0)");

  // 磨砂玻璃是「模糊半径」数值偏好：0 = 关，输入 8 就是 8px 半径。
  const blur = page.getByLabel("磨砂玻璃（模糊半径）");
  await blur.fill("8");
  await blur.press("Enter");
  await expect.poll(async () => (await read()).groupFilter).not.toBe("none");
  const on = await read();
  expect(on.attribute).toBe("");
  expect(on.blurRadius).toBe("8px");
  expect(on.containerClass).toBe(true);
  // 半透明与模糊必须一起给（只给一个就是糊状或看不出）。
  expect(on.groupBackground).toMatch(/rgba\(.*0\.\d+\)/);
  // 洞必须保持原样：否则宿主网页会被糊住。
  expect(on.holeFilter).toBe("none");
  expect(on.holeBackground).toBe("rgba(0, 0, 0, 0)");

  // 菜单不在 dockview 子树里，靠自己的 class 吃上同一套。
  await page.getByRole("button", { name: "切换菜单" }).click();
  await expect(page.locator("[data-context-menu-root]")).toHaveClass(/gpen-blur/);
  expect(
    await page
      .locator("[data-context-menu-root]")
      .evaluate((element) => getComputedStyle(element).backdropFilter),
  ).not.toBe("none");
  await page.keyboard.press("Escape");

  await blur.fill("0");
  await blur.press("Enter");
  await expect.poll(async () => (await read()).groupFilter).toBe("none");
  const back = await read();
  expect(back.attribute).toBeNull();
  expect(back.blurRadius).toBe("");
  expect(back.groupBackground).toBe(off.groupBackground);
});
