import { expect, test, type Page } from "playwright/test";

import { openWorkspace } from "./helpers/workspace";

/**
 * 工作区缩放下的交互几何。
 *
 * 背景（详见 `tmp/921-pm.md` 的「缩放修复」）：容器上那句 `style:zoom={workspaceZoom}`
 * 会让「客户端 px」与「容器内 px」差一个 zoom 的倍数，而 dockview 内部按
 * 「一个客户端 px = 一个容器 px」算，于是 uiScale / pinch 不为 1 时：
 *
 * - sash 拖动：面板尺寸按 zoom 倍数跑（10px → 20px）；
 * - 右键菜单：尺寸不跟（菜单挂在 dockview 子树外，见 `context-menu.e2e.ts`）。
 *
 * 这里守住 sash（`workspaceSashZoom.ts` 的坐标修正）。
 */

/** 把界面缩放调到目标值（1 / 0.5 / 2 都是 `UI_SCALE_STEP` 的整数倍）。 */
async function setUiScale(page: Page, target: number) {
  await page.locator(".blender-panel-menu .ui-scale-value").click();
  await page.waitForTimeout(150);
  const button = target >= 1 ? "放大界面" : "缩小界面";
  const steps = Math.round(Math.abs(target - 1) / 0.25);
  for (let index = 0; index < steps; index += 1) {
    await page.locator(".blender-panel-menu").getByRole("button", { name: button }).click();
  }
  await page.waitForTimeout(300);
  await expect(page.locator(".blender-panel-menu .ui-scale-value")).toHaveText(
    `${target.toFixed(2)}×`,
  );
}

/** 拖一条竖向 sash，返回它实际移动的**视觉** px。 */
async function dragVerticalSash(page: Page, distance: number): Promise<number> {
  for (const sash of await page.locator(".dv-sash").all()) {
    const before = await sash.boundingBox();
    if (!before || before.height < before.width * 2 || before.height < 200) continue;
    const x = before.x + before.width / 2;
    const y = before.y + before.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + distance, y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await sash.boundingBox();
    return Math.round((after!.x - before.x) * 10) / 10;
  }
  throw new Error("找不到竖向 sash");
}

for (const scale of [1, 2, 0.5]) {
  test(`sash resize tracks the pointer at uiScale ${scale}`, async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    if (scale !== 1) await setUiScale(page, scale);

    const moved = await dragVerticalSash(page, 10);
    // 修好之后「手指 10px = 面板 10px」；回归时会是 10 × scale（2× 时 20px，0.5× 时 5px）。
    expect(moved).toBeGreaterThan(8);
    expect(moved).toBeLessThan(12);
  });
}

/**
 * 浮窗拖动：dockview 的实现在 zoom ≠ 1 下混用视觉 px 与容器 px
 * （`offset`/夹取边界都是 `getBoundingClientRect()` 派生的），实测 uiScale=2 时
 * 拖 10px 浮窗跳 1328px。修法是 `workspaceFloatingDrag.ts` 直接接管拖动。
 */
test("floating window drag tracks the pointer at uiScale 2", async ({ page }) => {
  await page.goto("/");
  await openWorkspace(page);
  await setUiScale(page, 2);

  await page.keyboard.press("Control+Alt+u");
  const float = page.locator(".dv-groupview-floating");
  await expect(float).toBeVisible();
  const grip = (await page
    .locator(".dv-resize-container .dv-floating-titlebar")
    .first()
    .boundingBox())!;
  const before = (await float.boundingBox())!;

  // 浮窗在 uiScale=2 下会被夹在容器右缘，所以往**左**拖。
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 10, grip.y + grip.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const after = (await float.boundingBox())!;
  const moved = Math.round(after.x - before.x);
  // 修好之后 1:1（我们接管后没有 dockview 那个启动阈值）；回归时是几百上千 px。
  expect(moved).toBeGreaterThanOrEqual(-13);
  expect(moved).toBeLessThanOrEqual(-7);

  // 还得在容器里（夹取写的是容器局部 px）。
  const viewport = page.viewportSize()!;
  expect(after.x).toBeGreaterThanOrEqual(-1);
  expect(after.x + after.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(after.y + after.height).toBeLessThanOrEqual(viewport.height + 1);
});
