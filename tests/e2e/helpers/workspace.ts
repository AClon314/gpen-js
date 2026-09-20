import { expect, type Locator, type Page } from "playwright/test";

/**
 * 工作区 e2e 的公共落点。这两个 helper 以前在 4~5 个 `.e2e.ts` 里各抄了一份
 * （`openWorkspace` 抄了 5 份、`gridSnapshot` 与矩形测量各写一套），
 * 差异只在细节上；集中在这里以后，加一个「等某个面板出现」的改动只需改一处。
 */

/**
 * 打开工作区。
 *
 * 重载后 `open` 是持久化偏好，工作区可能已经自己打开了、也可能还在飞浮球，
 * 所以先等「菜单栏或悬浮球」任一出现，再决定要不要点开。
 */
export async function openWorkspace(page: Page, options: { canvas?: boolean } = {}) {
  await expect(page.locator(".blender-panel-menu, .floating-button").first()).toBeVisible();
  if (await page.locator(".floating-button").isVisible()) {
    await page.locator(".floating-button").click();
  }
  await expect(page.locator(".blender-panel-menu")).toBeVisible();
  if (options.canvas) await expect(page.locator("canvas.stroke-surface")).toBeVisible();
}

/** 基准面板：任何布局回归都该以这几条带 / 面板为准。 */
const SNAPSHOT_PANELS = [
  ".blender-panel-menu",
  ".menu-row",
  ".tool-settings",
  ".blender-panel-viewport",
  ".blender-panel-statusbar",
  ".blender-panel-timeline",
] as const;

/**
 * 网格布局快照：所有**非浮动**组的矩形 + 基准面板的矩形。
 *
 * 用来断言「打开浮动面板不能动到网格」——dockview 的 `addPanel` 在没有 `floating` 时会把
 * `initialWidth/Height` 应用给 active 组（`group.api.setSize(...)`），一次性重排整个网格，
 * 之后把面板挪成浮窗也不会恢复（实测：菜单行被撑高、视口 / 状态栏尺寸全变）。
 */
export function gridSnapshot(page: Page) {
  return page.evaluate(
    (selectors) => {
      const round = (n: number) => Math.round(n);
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return `${round(r.x)},${round(r.y)} ${round(r.width)}x${round(r.height)}`;
      };
      const groups = [...document.querySelectorAll(".dv-groupview")]
        .filter((el) => !el.classList.contains("dv-groupview-floating"))
        .map(box)
        .join(" | ");
      const panels = selectors
        .map((selector) => {
          const el = document.querySelector(selector);
          return el ? box(el) : "missing";
        })
        .join(" | ");
      return { groups, panels };
    },
    SNAPSHOT_PANELS as unknown as string[],
  );
}

/** 元素横向溢出量（0 = 装得下；> 0 = 靠横向滚动才能看到全部内容）。 */
export function horizontalOverflow(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return -1;
    return el.scrollWidth - el.clientWidth;
  }, selector);
}

/**
 * 断言元素的中心点真的打在它自己身上。
 *
 * 这是「窄容器里顶部菜单栏点了没反应」的正面对照：当时 `overflow: hidden` 把后几个
 * 菜单裁掉，按钮仍然有布局盒子（`boundingBox()` 有值），但中心点下面是动作组的药丸，
 * 手指落下去打在别人身上。所以光断言「可见」不够，必须查命中测试。
 */
export async function expectHitsItself(page: Page, target: Locator, label: string) {
  const box = await target.boundingBox();
  expect(box, `${label} 应该有布局盒子`).not.toBeNull();
  const hit = await page.evaluate(
    ([x, y]) =>
      document
        .elementFromPoint(x, y)
        ?.closest("button, [role=button]")
        ?.getAttribute("aria-label") ?? null,
    [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
  );
  expect(hit, `${label} 的中心点应该打在它自己身上`).toBe(label);
}

/** 断言元素整个落在视口内（网格溢出容器时，右侧控件会落到屏幕外）。 */
export async function expectInsideViewport(page: Page, target: Locator, label: string) {
  const box = await target.boundingBox();
  expect(box, `${label} 应该有布局盒子`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const tolerance = 1;
  expect(box!.x, `${label} 不该从左边出去`).toBeGreaterThanOrEqual(-tolerance);
  expect(box!.y, `${label} 不该从上面出去`).toBeGreaterThanOrEqual(-tolerance);
  expect(box!.x + box!.width, `${label} 不该从右边出去`).toBeLessThanOrEqual(
    viewport!.width + tolerance,
  );
  expect(box!.y + box!.height, `${label} 不该从下面出去`).toBeLessThanOrEqual(
    viewport!.height + tolerance,
  );
}

/**
 * 断言这个横向条带**用户真的能滚**，而不是「能被程序滚」。
 *
 * `overflow: hidden` 的盒子也是 scroll container：`scrollLeft` 能写、Playwright 的
 * `scrollIntoViewIfNeeded()` 也能把它滚到可见区——所以只查「元素能不能被点中」会
 * 漏掉这个回归（消融实测：菜单行退回 `overflow: hidden` 后全部用例仍然通过，
 * 而用户手指 / 滚轮滚不动那条带）。所以这里用**用户输入**（滚轮，等价于触屏的
 * 横向 pan）来判断：`hidden` 的盒子纹丝不动。
 */
export async function expectUserScrollable(page: Page, selector: string) {
  const strip = page.locator(selector);
  const box = await strip.boundingBox();
  expect(box, `${selector} 应该有布局盒子`).not.toBeNull();
  expect(await strip.evaluate((el) => el.scrollLeft), `${selector} 初始不该是滚过的`).toBe(0);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(120, 0);
  await expect
    .poll(() => strip.evaluate((el) => el.scrollLeft), `${selector} 应该能被用户滚动`)
    .toBeGreaterThan(0);
}
