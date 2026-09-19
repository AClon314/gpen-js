import { expect, test, type Page } from "playwright/test";

/**
 * T3 回归：相机（spacer）、Web 图层旋转、沉浸模式。
 *
 * 用首页 `/`：它的 `main` 足够高（`'测试'.repeat(9999)`），能同时测到「绕视口中心
 * 旋转不会把正在看的内容甩出视口」和「相机 spacer 扩大滚动范围」。
 */
async function openWorkspace(page: Page) {
  await page.locator(".floating-button").click();
  await expect(page.locator(".blender-panel-menu")).toBeVisible();
}

function readMain(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!(main instanceof HTMLElement)) return null;
    const style = getComputedStyle(main);
    const rect = main.getBoundingClientRect();
    return {
      transform: style.transform,
      rotate: style.rotate,
      transformOrigin: style.transformOrigin,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
}

test.describe("spacer camera", () => {
  test("keeps the page origin, the scrollbar and the host DOM", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toBeAttached();
    // 打开前的宿主 DOM：内容不能因为打开工作区而被换父节点。
    const parentBefore = await page.evaluate(
      () => document.querySelector("main")?.parentElement?.tagName ?? null,
    );
    await openWorkspace(page);

    const info = await page.evaluate(() => ({
      spacerCount: document.querySelectorAll("[data-gpen-canvas-space]").length,
      spacerPointerEvents: getComputedStyle(
        document.querySelector("[data-gpen-canvas-space]") as HTMLElement,
      ).pointerEvents,
      parentTag: document.querySelector("main")?.parentElement?.tagName ?? null,
      mainInsideWrapper:
        document.querySelector("main")?.closest(".gpen-infinite-surface, .gpen-infinite-origin") !==
        null,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      htmlScrollbarWidth: document.documentElement.style.getPropertyValue("scrollbar-width"),
    }));

    expect(info.spacerCount).toBe(1);
    expect(info.spacerPointerEvents).toBe("none");
    expect(info.parentTag).toBe(parentBefore);
    expect(info.mainInsideWrapper).toBe(false);
    expect(info.scrollY).toBe(0);
    expect(info.scrollHeight).toBeGreaterThan(100_000);
    // 旧的 hideScrollbar 写入必须已经删掉：滚动条保留。
    expect(info.htmlScrollbarWidth).toBe("");

    // 滚动不能为负（这是 spacer 方案的固有边界）。
    await page.evaluate(() => window.scrollTo(0, -500));
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // 但可以滚进 spacer。
    await page.evaluate(() => window.scrollTo(0, 50_000));
    expect(await page.evaluate(() => window.scrollY)).toBe(50_000);
  });

  test("removes the spacer when the workspace closes and re-adds exactly one", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
    expect(await page.locator("[data-gpen-canvas-space]").count()).toBe(1);

    await page.getByLabel("关闭 gpen").click();
    await expect(page.locator("[data-gpen-canvas-space]")).toHaveCount(0);

    await openWorkspace(page);
    expect(await page.locator("[data-gpen-canvas-space]").count()).toBe(1);
  });
});

test.describe("web layer rotation", () => {
  test("rotates with the independent rotate property and restores it", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toBeAttached();
    const before = await readMain(page);
    expect(before).not.toBeNull();

    await openWorkspace(page);
    await page.getByLabel("顺时针旋转 15 度").click();
    await page.getByLabel("顺时针旋转 15 度").click();
    await expect(page.locator(".view-rotate-value")).toHaveText("30.0°");

    const during = await readMain(page);
    // 页面自己的 transform 不能被覆盖。
    expect(during!.transform).toBe(before!.transform);
    expect(during!.rotate).toContain("30deg");
    // 枢轴换成了"旋转那一刻的视口中心"，不再是默认的图层中心。
    expect(during!.transformOrigin).not.toBe(before!.transformOrigin);
    // 枢轴确实命中了视口中心附近的图层内容：绕它旋转不会把当前视口转空。
    expect(during!.rect.width).toBeGreaterThan(0);
    expect(during!.rect.height).toBeGreaterThan(0);

    // T4：打开工作区 = 绘制模式，视口中心归画布（`canvas.stroke-surface`）。
    // 宿主网页的命中测试由「最小化」交还（见 tests/embed/embed.e2e.ts）。
    const hit = await page.evaluate(() => {
      const element = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return {
        isCanvas: element?.classList.contains("stroke-surface") ?? false,
        mainRotate: getComputedStyle(document.querySelector("main") as HTMLElement).rotate,
      };
    });
    expect(hit.isCanvas).toBe(true);
    // 画布覆盖不影响页面自身的旋转投影。
    expect(hit.mainRotate).toContain("30deg");

    await page.getByLabel("重置视图旋转").click();
    const after = await readMain(page);
    expect(after!.rotate).toBe(before!.rotate);
    expect(after!.transformOrigin).toBe(before!.transformOrigin);
  });

  test("guesses the web layer once per workspace session", async ({ page }) => {
    const guesses: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("guessWebLayer candidates")) guesses.push(message.text());
    });

    await page.goto("/");
    await openWorkspace(page);
    await page.getByLabel("顺时针旋转 15 度").click();
    await page.getByLabel("逆时针旋转 15 度").click();
    await page.waitForTimeout(200);

    expect(guesses).toHaveLength(1);
  });
});

test.describe("immersive mode", () => {
  test("makes the page origin interactive and exits with Escape", async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);

    await page.getByLabel("进入沉浸模式").click();
    await expect(page.locator(".immersive-exit")).toBeVisible();

    // 页面 (0,0) 必须回到页面手里：没有 chrome 覆盖它。
    const hit = await page.evaluate(() => {
      const element = document.elementFromPoint(2, 2);
      return { inOverlay: Boolean(element?.closest(".gpen-overlay")) };
    });
    expect(hit.inOverlay).toBe(false);

    await page.keyboard.press("Escape");
    await expect(page.getByLabel("进入沉浸模式")).toBeVisible();
    await expect(page.locator(".blender-panel-menu")).toBeVisible();
  });
});
