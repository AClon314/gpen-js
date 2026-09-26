/**
 * sash（分割条）拖动的坐标修正。
 *
 * dockview 的 `Gridview` 把 `event.clientX - start` **直接当容器内 px** 用
 * （`dockview/dist/dockview.js` 的 sash `pointermove`），而容器被 `style:zoom` 缩过：
 * 一个内部 px = `zoom` 个视觉 px。于是 `zoom ≠ 1` 时面板尺寸按 zoom 的倍数跑
 * （实测 uiScale=2：手指移动 10px → 面板变化 20px）。
 *
 * 修法：只在拖动期间（capture 阶段）把指针坐标换算回容器坐标，再把修正过的事件重新派发
 * 给 sash —— dockview 挂在 `document` 上的监听收到的就是它以为的坐标系里的值。
 * `zoom = 1`（绝大多数情况）时完全不介入，不产生额外事件。
 *
 * 注意这是**补丁**而不是改 dockview：为什么不去改容器 zoom 机制见 `tmp/921-pm.md`
 * 的「缩放修复」一节（整体 CSS zoom 与 dockview 的 px 数学天然不兼容，只能逐个交互补）。
 */

import {
  installZoomGesture,
  isPrimaryPointerPress,
  isUsableZoom,
} from "./workspaceFloatingGeometry.js";

interface ActiveSashDrag {
  startX: number;
  startY: number;
  /** 按下时的缩放；拖动过程中不变。 */
  zoom: number;
  target: Element;
}

/** 修正后的 PointerEvent：dockview 读 clientX/clientY（还有 buttons/pointerId 等）。 */
function correctedPointerEvent(
  event: PointerEvent,
  clientX: number,
  clientY: number,
): PointerEvent {
  const init: PointerEventInit = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    pressure: event.pressure,
  };
  if (event.width > 0) init.width = event.width;
  if (event.height > 0) init.height = event.height;
  return new PointerEvent("pointermove", init);
}

/** 面板分隔条拖动缩放修正器（卸载时 `dispose()`）。 */
export interface SashZoomCorrection {
  dispose(): void;
}

/**
 * 装上修正器：`container` 里 `.dv-sash` 的拖动会被换算回容器坐标。
 * `getZoom()` 每次按下时读一次（与 `GpenWorkspace` 的 `workspaceZoom` 同源）。
 */
export function installSashZoomCorrection(options: {
  container: HTMLElement;
  getZoom(): number;
}): SashZoomCorrection {
  return installZoomGesture<ActiveSashDrag>({
    container: options.container,
    // 右键菜单会打断拖动（原实现如此），所以也当作结束。
    endOnContextMenu: true,
    handlers: {
      start(event) {
        // 只接管主键（触屏 / 笔没有 button 语义，按下即有效）。
        if (!isPrimaryPointerPress(event)) return undefined;
        const target = event.target;
        if (!(target instanceof Element)) return undefined;
        const sash = target.closest(".dv-sash");
        if (!sash) return undefined;
        const zoom = options.getZoom();
        if (!isUsableZoom(zoom)) return undefined;
        return { startX: event.clientX, startY: event.clientY, zoom, target: sash };
      },
      move(event, drag) {
        // `isTrusted === false` = 我们自己刚派发的修正事件，不能再拦一次（否则递归到爆栈）。
        if (!event.isTrusted) return;
        // 原事件到此为止：换成换算后的坐标再放行，否则 dockview 会按视觉 px 改布局。
        event.stopImmediatePropagation();
        const clientX = drag.startX + (event.clientX - drag.startX) / drag.zoom;
        const clientY = drag.startY + (event.clientY - drag.startY) / drag.zoom;
        const corrected = correctedPointerEvent(event, clientX, clientY);
        const target = drag.target.isConnected ? drag.target : document;
        target.dispatchEvent(corrected);
      },
    },
  });
}
