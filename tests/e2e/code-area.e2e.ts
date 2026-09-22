import { expect, test, type Page } from "playwright/test";

import { openWorkspace } from "./helpers/workspace";

/**
 * CodeArea 回归：文件菜单「调试：内部 JSON 状态树」→ viewport 组的实时 JSON tab。
 *
 * 守住四件事：它真的作为**同组的 tab**打开（不是新组、不是浮窗）、切过去之后视口不再是「洞」、
 * 同一条命令幂等、以及**同步部分真的是实时的**（改 uiScale 不改代码就能看到数字变）。
 */

const CODE_AREA_TAB = '.dv-tab[data-tab-panel-id="codearea:gpen-internal-state"]';
const CODE_AREA_PANEL = ".blender-panel-codearea";

async function openInternalStateArea(page: Page) {
  await page.getByRole("button", { name: "文件菜单" }).click();
  await page.getByRole("menuitem", { name: "调试：内部 JSON 状态树" }).click();
  await expect(page.locator(CODE_AREA_PANEL)).toBeVisible();
}

/** CodeMirror 里的全文（`.cm-content` 是 contenteditable，直接读 textContent）。 */
function editorText(page: Page) {
  return page.locator(`${CODE_AREA_PANEL} .cm-content`).innerText();
}

test.describe("code area", () => {
  test("opens as a tab in the viewport group, idempotently", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);

    // 打开前：视口那一组是「洞」。
    await expect(page.locator(".dv-groupview.gpen-hole")).toHaveCount(1);

    await openInternalStateArea(page);
    await expect(page.locator(CODE_AREA_TAB)).toHaveCount(1);

    // 与视口同组（两个 tab 一个组），而不是新建了一个组。
    // 注意：active tab 不是视口时，视口的 panel 内容会被 dockview **卸载**
    // （默认 renderer `onlyWhenVisible`），所以这一组不能靠 `.blender-panel-viewport` 找。
    const group = page.locator(".dv-groupview").filter({ has: page.locator(CODE_AREA_TAB) });
    await expect(group.locator(".dv-tab")).toHaveCount(2);
    await expect(group.locator(".dv-tab", { hasText: "视口" })).toHaveCount(1);
    await expect(group.locator(CODE_AREA_TAB)).toHaveCount(1);
    await expect(page.locator(".dv-groupview.gpen-hole")).toHaveCount(0);

    // 幂等：再跑一次命令只聚焦，不开第二个面板 / 第二个组。
    await openInternalStateArea(page);
    await expect(page.locator(CODE_AREA_PANEL)).toHaveCount(1);
    await expect(page.locator(".dv-groupview-floating")).toHaveCount(0);
  });

  test("shows the live state tree and follows uiScale", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    await openInternalStateArea(page);

    // CodeMirror 只把可见行渲染进 DOM（虚拟滚动），所以断言只用**首屏**能看到的内容：
    // `viewport` 一节在最前面（它就是排查缩放问题的入口）。
    const text = await editorText(page);
    expect(text).toContain('"viewport"');
    expect(text).toContain('"workspaceZoom": 1');
    expect(text).toContain('"scale"');
    // 高频值也在树里（「真实完整」）：宿主页滚动量与画布范围。
    expect(text).toContain('"scrollY"');
    expect(text).toContain('"scrollHeight"');
    // 只读数据源：有「提交」但没有可写源时它必须是禁用的，「刷新」可用。
    await expect(page.getByRole("button", { name: "提交" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "刷新" })).toBeEnabled();

    // 同步部分是实时的：改界面缩放 → 树里的数字跟着变。
    await page.locator(".blender-panel-menu").getByRole("button", { name: "放大界面" }).click();
    await expect
      .poll(() => editorText(page), { timeout: 5_000 })
      .toContain('"workspaceZoom": 1.25');
  });

  test("closes from the tab button and gives the hole back", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    await openInternalStateArea(page);

    // 其他 tab 的关闭按钮是藏起来的；CodeArea 是「文件 tab」，必须看得见。
    const close = page.locator(`${CODE_AREA_TAB} .dv-default-tab-action`);
    await expect(close).toBeVisible();
    await close.click();

    await expect(page.locator(CODE_AREA_PANEL)).toHaveCount(0);
    await expect(page.locator(".dv-groupview.gpen-hole")).toHaveCount(1);
  });
});

test("is not resurrected by a page reload", async ({ page }) => {
  await page.goto("/");
  await openWorkspace(page);
  await openInternalStateArea(page);
  // 布局记忆是 debounce 落盘的，给它一点时间。
  await page.waitForTimeout(1500);

  await page.reload();
  await openWorkspace(page);
  await expect(page.locator(CODE_AREA_PANEL)).toHaveCount(0);
  await expect(page.locator(CODE_AREA_TAB)).toHaveCount(0);
  // 视口还在、也还是「洞」：摘掉调试面板不能把布局弄坏。
  await expect(page.locator(".dv-groupview.gpen-hole")).toHaveCount(1);
  await expect(page.locator(".dv-tab", { hasText: "视口" })).toHaveCount(1);
});

/** 当前 DOM selection 的屏幕位置（编辑器有焦点时就是 caret）。 */
function caretRect(page: Page) {
  return page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y) };
  });
}

test("scrolls its own content and keeps the caret across live updates", async ({ page }) => {
  await page.goto("/");
  await openWorkspace(page);
  await openInternalStateArea(page);

  const scroller = page.locator(`${CODE_AREA_PANEL} .cm-scroller`);
  const box = (await page.locator(`${CODE_AREA_PANEL} .cm-content`).boundingBox())!;

  // 1) 编辑器自己滚：`.cm-scroller` 真的有溢出，滚轮不该落到宿主网页上
  //    （回归：flex 链缺一层时 CM 的高度 = 内容高度，滚轮直接穿透到底下的 web layer）。
  const metrics = await scroller.evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  expect(metrics.scroll).toBeGreaterThan(metrics.client);
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // 2) 放下 caret，然后**不抢焦点**地触发一次实时更新（滚宿主网页 → viewportRevision → 树重算）
  await page.mouse.click(box.x + 60, box.y + 120);
  await page.waitForTimeout(200);
  const caretBefore = await caretRect(page);
  const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
  expect(caretBefore, "点击后应该有 caret").not.toBeNull();

  await page.mouse.move(640, 40);
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
    .toBeGreaterThan(0);
  // 等去抖窗口过去（250ms）再断言。
  await page.waitForTimeout(900);

  expect(await scroller.evaluate((el) => el.scrollTop), "滚动位置不该被更新弹走").toBe(
    scrollBefore,
  );
  const caretAfter = await caretRect(page);
  expect(caretAfter?.y, "caret 不该被更新弹走").toBe(caretBefore?.y);
  expect(await page.evaluate(() => document.activeElement?.closest(".cm-editor") !== null)).toBe(
    true,
  );
});
