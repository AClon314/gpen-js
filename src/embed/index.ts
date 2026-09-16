/**
 * gpen embed 入口：把 GpenOverlay + ContextMenu 挂进一个 ShadowRoot。
 *
 * 设计要点（见 docs/build-targets.md）：
 * - 宿主（页面/DOM）只看见一个零尺寸的 `<div id="gpen-host">`，所有样式都注入 shadow，
 *   不污染宿主页；Svelte 组件样式随构建产物一起内联（vite.embed.config.ts）。
 * - host 挂在 `document.documentElement` 末尾：不在 `guessWebLayer()` 的扫描范围内
 *   （只扫 body 直接子元素），也不受宿主 `body { position/transform/margin }` 影响。
 * - 幂等：重复 mount 返回同一个 handle；`unmount()` 会摘掉 host 与事件。
 */
import "../app.css";

import { mount, unmount, type Component } from "svelte";

import GpenOverlay from "#lib/components/GpenOverlay.svelte";
import ContextMenu from "#lib/components/contextMenu/ContextMenu.svelte";
import { gpenEmbedCss } from "./css.js";
import { initTheme } from "../lib/themes/theme.svelte.js";

export const GPEN_HOST_ID = "gpen-host";

export interface GpenEmbedOptions {
  /** 自定义宿主元素（默认自建并挂到 documentElement）。 */
  host?: HTMLElement;
}

export interface GpenHandle {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  unmount(): void;
}

let current: GpenHandle | undefined;

function createHost(): HTMLElement {
  const host = document.createElement("div");
  host.id = GPEN_HOST_ID;
  host.dataset.gpenOverlayHost = "";
  // 零尺寸 + 绝对定位在文档原点：overlay 内部用绝对定位按 visualViewport 页面坐标定位，
  // 悬浮球与菜单自己是 position: fixed，不受这里影响。
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;overflow:visible";
  document.documentElement.append(host);
  return host;
}

/** 把 gpen 挂进 ShadowRoot；重复调用返回同一个 handle。 */
export function mountGpen(options: GpenEmbedOptions = {}): GpenHandle {
  if (current) return current;

  const host = options.host ?? createHost();
  // JS takes over the `:host` tokens of the shadow root.
  initTheme(host);
  const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.dataset.gpenEmbedStyle = "";
  style.textContent = gpenEmbedCss;
  shadowRoot.append(style);

  const container = document.createElement("div");
  container.dataset.gpenEmbedRoot = "";
  shadowRoot.append(container);

  const apps: Array<ReturnType<typeof mount>> = [
    mount(GpenOverlay as Component, { target: container }),
    mount(ContextMenu as Component, { target: container }),
  ];

  const handle: GpenHandle = {
    host,
    shadowRoot,
    unmount() {
      for (const app of apps.splice(0)) void unmount(app);
      host.remove();
      if (current === handle) current = undefined;
    },
  };
  current = handle;
  return handle;
}

/** 卸载 gpen（未挂载时是 no-op）。 */
export function unmountGpen(): void {
  current?.unmount();
}

/** 当前是否已挂载。 */
export function isGpenMounted(): boolean {
  return current !== undefined;
}
