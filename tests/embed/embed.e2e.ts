import { readFileSync } from "node:fs";

import { expect, test } from "playwright/test";

const EMBED_BUNDLE = "dist/embed/gpen-embed.iife.js";

/**
 * 期望值从 token 定义里现取，而不是抄一个色号：色号会随主题改，抄下来只会变成
 * 新的维护点（`--gpen-danger` 就从 #fee2e2 改成过 #d24b4b，测试忘了跟）。
 * 文件里第一处 `--gpen-danger` 是白天那套（夜间在后面的 @media 块里）。
 */
const LIGHT_DANGER_TOKEN = /--gpen-danger:\s*([^;]+);/
  .exec(readFileSync("src/lib/themes/day-night.css", "utf8"))?.[1]
  ?.trim();

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>host page</title>
<style>body { margin: 8px } .marker { color: rgb(1, 2, 3) }</style>
</head><body>
  <main id="page-content" class="marker">host page content</main>
  <button id="page-button">page button</button>
  <script>
    window.__clicked = 0;
    document.addEventListener('click', () => { window.__clicked += 1 });
  </script>
</body></html>`;

type EmbedGlobals = {
  mountGpen(options?: { host?: HTMLElement }): {
    host: HTMLElement;
    shadowRoot: ShadowRoot;
    unmount(): void;
  };
  unmountGpen(): void;
  isGpenMounted(): boolean;
};

declare global {
  interface Window {
    GpenEmbed: EmbedGlobals;
  }
}

test.describe("gpen embed", () => {
  test("mounts into a shadow root without leaking styles or breaking the host page", async ({
    page,
  }) => {
    await page.setContent(PAGE);
    const headStylesBefore = await page.locator("head style").count();
    await page.addScriptTag({ path: EMBED_BUNDLE });

    const mounted = await page.evaluate(() => {
      const handle = window.GpenEmbed.mountGpen();
      return {
        mountedFlag: window.GpenEmbed.isGpenMounted(),
        hostId: handle.host.id,
        hostParent: handle.host.parentElement?.tagName,
        shadowMode: handle.shadowRoot.mode,
        hasStyle: !!handle.shadowRoot.querySelector("style[data-gpen-embed-style]"),
        ballVisible: !!handle.shadowRoot.querySelector(".floating-button"),
      };
    });
    expect(mounted).toMatchObject({
      mountedFlag: true,
      hostId: "gpen-host",
      hostParent: "HTML",
      shadowMode: "open",
      hasStyle: true,
      ballVisible: true,
    });

    // CSS 内容本身是干净的（历史上踩过「多包一层引号」的坑：字符串以 " 开头）
    const cssText = await page.evaluate(
      () =>
        window.GpenEmbed.mountGpen().shadowRoot.querySelector("style[data-gpen-embed-style]")
          ?.textContent ?? "",
    );
    expect(cssText.startsWith('"')).toBe(false);
    expect(cssText).toContain("--gpen-danger");
    // 样式真的生效（不只是 style 元素存在）：tailwind 的 --gpen-* token 在 shadow 里可读
    const tokenValue = await page.evaluate(() =>
      getComputedStyle(
        window.GpenEmbed.mountGpen().shadowRoot.firstElementChild as Element,
      ).getPropertyValue("--gpen-danger"),
    );
    expect(tokenValue.trim()).toBe(LIGHT_DANGER_TOKEN);

    // 样式只在 shadow 里：宿主页 head 没有新增 style，页面自己的样式不受影响
    expect(await page.locator("head style").count()).toBe(headStylesBefore);
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector(".marker")!).color),
    ).toBe("rgb(1, 2, 3)");

    // 幂等：重复 mount 不新增 host
    expect(
      await page.evaluate(() => window.GpenEmbed.mountGpen() === window.GpenEmbed.mountGpen()),
    ).toBe(true);
    expect(await page.locator("#gpen-host").count()).toBe(1);

    // 点悬浮球打开工作区（dockview 出现在 shadow 里）。用真实指针事件：
    // 悬浮球走的是 draggable action 的 pointerdown/pointerup，不是原生 click。
    const shadowRoot = page.locator("#gpen-host").locator("button.floating-button");
    await shadowRoot.click();
    await expect(page.locator("#gpen-host").locator(".dockview-container")).toBeVisible();

    // 视口那一组必须是"洞"：透明（宿主网页从中间透出来）且不接指针。
    // 这条断言守的是"面板内容缺失 / 分组标记漏打 → 视口变不透明"这个回归。
    const hole = await page.evaluate(() => {
      const group = document
        .querySelector("#gpen-host")
        .shadowRoot.querySelector(".dv-groupview.gpen-hole");
      if (!group) return null;
      const styles = getComputedStyle(group);
      return { background: styles.backgroundColor, pointerEvents: styles.pointerEvents };
    });
    expect(hole).not.toBeNull();
    expect(hole?.background).toBe("rgba(0, 0, 0, 0)");
    expect(hole?.pointerEvents).toBe("none");

    // 工作区打开时宿主页仍可交互（透明视口事件穿透）。
    //
    // 点在**洞内**（可视区中心），而不是页面左上角的按钮：相机换成绝对定位
    // spacer 之后，`x < rail 宽 / y < 菜单高` 的像素永远进不了洞（scroll 不能为负，
    // 见 docs/layer-view.md）。洞内的穿透才是这套方案要守的契约。
    const center = await page.evaluate(() => ({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      hitOverlay: Boolean(
        document
          .elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
          ?.closest("#gpen-host"),
      ),
    }));
    expect(center.hitOverlay).toBe(false);
    // shadow 里的点击（悬浮球）也会冒泡到 document，所以先清零再点。
    await page.evaluate(() => {
      window.__clicked = 0;
    });
    await page.mouse.click(center.x, center.y);
    expect(await page.evaluate(() => window.__clicked)).toBe(1);

    // 卸载干净
    await page.evaluate(() => window.GpenEmbed.unmountGpen());
    expect(await page.locator("#gpen-host").count()).toBe(0);
    expect(await page.evaluate(() => window.GpenEmbed.isGpenMounted())).toBe(false);
  });

  test("reuses an existing host element and can clean up a second time", async ({ page }) => {
    await page.setContent(PAGE);
    await page.addScriptTag({ path: EMBED_BUNDLE });
    const result = await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "custom-host";
      document.body.append(host);
      const handle = window.GpenEmbed.mountGpen({ host });
      const again = window.GpenEmbed.mountGpen();
      const sameHost = handle.host === again.host;
      window.GpenEmbed.unmountGpen();
      window.GpenEmbed.unmountGpen(); // no-op
      return { sameHost, customHostStillThere: !!document.getElementById("custom-host") };
    });
    expect(result).toEqual({ sameHost: true, customHostStillThere: false });
  });
});
