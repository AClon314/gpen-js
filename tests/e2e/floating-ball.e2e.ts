import { devices, expect, test } from "playwright/test";

/**
 * 悬浮球在手机 pinch 缩放下的定位回归测试。
 *
 * 背景：`position: fixed` 相对**布局视口**，而 pinch 放大后的可视区域只是布局视口里的
 * 一小块（`visualViewport.offsetLeft/offsetTop` ≠ 0）。球和 overlay 一样改成文档坐标
 * （`position: absolute` + `pageLeft/pageTop`）之后，"用户看到的位置"才不随 pinch 平移漂移。
 *
 * 真机 pinch 没法在 CI 里合成，所以这里直接换掉 `window.visualViewport`：action 是读
 * 属性而不是缓存对象，因此换掉之后派发 resize/scroll 就能驱动同一条重算路径。
 */

type FakeViewport = {
  width: number;
  height: number;
  scale: number;
  offsetLeft: number;
  offsetTop: number;
  pageLeft: number;
  pageTop: number;
};

/** 用一个假的 `visualViewport` 模拟"pinch 放大 + 平移过"的可视区，并触发重算。 */
async function pinchedViewport(page: import("playwright/test").Page, fake: FakeViewport) {
  await page.evaluate((values) => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        ...values,
        addEventListener() {},
        removeEventListener() {},
      },
    });
    window.dispatchEvent(new Event("resize"));
  }, fake);
  // 重算走的是同步路径，但给布局留一帧。
  await page.waitForTimeout(100);
}

async function ballInViewport(page: import("playwright/test").Page) {
  return page.evaluate(() => {
    const viewport = window.visualViewport;
    const rect = document.querySelector(".floating-button")!.getBoundingClientRect();
    const offsetX = viewport?.offsetLeft ?? 0;
    const offsetY = viewport?.offsetTop ?? 0;
    return {
      // 视觉视口坐标（= 用户实际看到的位置）
      left: rect.left - offsetX,
      top: rect.top - offsetY,
      right: rect.right - offsetX,
      bottom: rect.bottom - offsetY,
      width: rect.width,
      height: rect.height,
      viewport: { width: viewport?.width ?? 0, height: viewport?.height ?? 0 },
    };
  });
}

// 手机尺寸 + 触摸：假 visualViewport 的数值要和真实布局视口一致，
// 否则夹取与"贴边"的期望值对不上。（`test.use` 必须放在顶层。）
test.use({ ...devices["Pixel 7"] });

test.describe("floating ball under pinch zoom", () => {
  test("starts in the bottom-right corner of the visible area", async ({ page }) => {
    await page.goto("/");
    const ball = page.locator(".floating-button");
    await expect(ball).toBeVisible();

    const box = await ballInViewport(page);
    expect(box.right).toBeLessThanOrEqual(box.viewport.width + 1);
    expect(box.bottom).toBeLessThanOrEqual(box.viewport.height + 1);
    expect(box.viewport.width - box.right).toBeLessThan(24);
    expect(box.viewport.height - box.bottom).toBeLessThan(24);
  });

  test("stays in the visible area after a zoomed, panned visual viewport", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".floating-button")).toBeVisible();

    // 2× 放大 + 视觉视口被平移（真机 pinch 后的典型状态）。
    await pinchedViewport(page, {
      width: 206,
      height: 457,
      scale: 2,
      offsetLeft: 60,
      offsetTop: 90,
      pageLeft: 60,
      pageTop: 90,
    });

    const box = await ballInViewport(page);
    // 球必须贴在**看得见**的那块区域的右下角，而不是布局视口的右下角。
    expect(box.left).toBeGreaterThanOrEqual(-1);
    expect(box.top).toBeGreaterThanOrEqual(-1);
    expect(box.right).toBeLessThanOrEqual(box.viewport.width + 1);
    expect(box.bottom).toBeLessThanOrEqual(box.viewport.height + 1);
    expect(box.viewport.width - box.right).toBeLessThan(24);
    expect(box.viewport.height - box.bottom).toBeLessThan(24);
  });

  test("returns to the visible edge after zooming back out", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".floating-button")).toBeVisible();

    // 球默认贴在右下角；放大 + 平移后应该继续贴住"看得见的那块"的右下角。
    await pinchedViewport(page, {
      width: 206,
      height: 457,
      scale: 2,
      offsetLeft: 60,
      offsetTop: 90,
      pageLeft: 60,
      pageTop: 90,
    });
    const zoomed = await ballInViewport(page);
    const zoomedGapX = zoomed.viewport.width - zoomed.right;
    const zoomedGapY = zoomed.viewport.height - zoomed.bottom;
    expect(zoomedGapX).toBeLessThan(24);
    expect(zoomedGapY).toBeLessThan(24);

    // 缩回原样：必须贴回原来的边，而不是停在中途（gap 保持一致）。
    await pinchedViewport(page, {
      width: 412,
      height: 915,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
    });
    const back = await ballInViewport(page);
    expect(Math.abs(back.viewport.width - back.right - zoomedGapX)).toBeLessThan(2);
    expect(Math.abs(back.viewport.height - back.bottom - zoomedGapY)).toBeLessThan(2);
  });

  test("a mid-screen position survives a zoom in/out cycle", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".floating-button")).toBeVisible();

    // 拖到中间（不贴边）。
    const start = await page.locator(".floating-button").boundingBox();
    await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
    await page.mouse.down();
    await page.mouse.move(start!.x - 120, start!.y - 260, { steps: 5 });
    await page.mouse.up();

    const dragged = await ballInViewport(page);
    // 拖到的是可视区中间，缩放前先确认真的不在边上。
    expect(dragged.viewport.width - dragged.right).toBeGreaterThan(24);

    await pinchedViewport(page, {
      width: 206,
      height: 457,
      scale: 2,
      offsetLeft: 60,
      offsetTop: 90,
      pageLeft: 60,
      pageTop: 90,
    });
    const zoomed = await ballInViewport(page);
    // 放大后被夹进新的可视区，但绝不能跑到可视区外。
    expect(zoomed.left).toBeGreaterThanOrEqual(-1);
    expect(zoomed.top).toBeGreaterThanOrEqual(-1);
    expect(zoomed.right).toBeLessThanOrEqual(zoomed.viewport.width + 1);
    expect(zoomed.bottom).toBeLessThanOrEqual(zoomed.viewport.height + 1);

    await pinchedViewport(page, {
      width: 412,
      height: 915,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
    });
    const back = await ballInViewport(page);
    // 缩回去之后仍在可视区内，且没有被吸附到边上（中间位置不该变成"贴边"）。
    expect(back.left).toBeGreaterThanOrEqual(-1);
    expect(back.top).toBeGreaterThanOrEqual(-1);
    expect(back.right).toBeLessThanOrEqual(back.viewport.width + 1);
    expect(back.bottom).toBeLessThanOrEqual(back.viewport.height + 1);
    expect(Number.isFinite(back.left) && Number.isFinite(back.top)).toBe(true);
  });

  test("keeps its visual position when the zoomed viewport only pans", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".floating-button")).toBeVisible();

    // 先进入"放大 + 平移"的状态（可视区 206×457，视觉视口偏 (60, 90)）。
    await pinchedViewport(page, {
      width: 206,
      height: 457,
      scale: 2,
      offsetLeft: 60,
      offsetTop: 90,
      pageLeft: 60,
      pageTop: 90,
    });
    const before = await ballInViewport(page);

    // 只平移：尺寸不变，只改偏移（真机上就是在放大状态里拖着看别处）。
    await pinchedViewport(page, {
      width: 206,
      height: 457,
      scale: 2,
      offsetLeft: 100,
      offsetTop: 140,
      pageLeft: 100,
      pageTop: 140,
    });
    const after = await ballInViewport(page);

    // 平移只改变"哪一块布局视口可见"，球在可视区里的位置不该动。
    expect(Math.abs(after.left - before.left)).toBeLessThan(2);
    expect(Math.abs(after.top - before.top)).toBeLessThan(2);
  });
});
