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

interface ActiveSashDrag {
  pointerId: number;
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
  let active: ActiveSashDrag | undefined;

  function onPointerDown(event: PointerEvent): void {
    // 只接管主键（触屏 / 笔没有 button 语义，按下即有效）。
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const sash = target.closest(".dv-sash");
    if (!sash) return;
    const zoom = options.getZoom();
    if (!Number.isFinite(zoom) || zoom <= 0 || Math.abs(zoom - 1) < 1e-3) return;
    active = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      zoom,
      target: sash,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    // `isTrusted === false` = 我们自己刚派发的修正事件，不能再拦一次（否则递归到爆栈）。
    if (!event.isTrusted) return;
    const drag = active;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // 原事件到此为止：换成换算后的坐标再放行，否则 dockview 会按视觉 px 改布局。
    event.stopImmediatePropagation();
    const clientX = drag.startX + (event.clientX - drag.startX) / drag.zoom;
    const clientY = drag.startY + (event.clientY - drag.startY) / drag.zoom;
    const corrected = correctedPointerEvent(event, clientX, clientY);
    const target = drag.target.isConnected ? drag.target : document;
    target.dispatchEvent(corrected);
  }

  function end(event: { pointerId?: number }): void {
    if (active && event.pointerId !== undefined && event.pointerId !== active.pointerId) return;
    active = undefined;
  }

  const onContextMenu = () => end({});
  const onBlur = () => end({});

  options.container.addEventListener("pointerdown", onPointerDown, true);
  // 监听挂在 window 的 capture 阶段：dockview 的 pointermove 在 document 的 bubble 阶段，
  // 这里必须比它先看到事件（否则它已经按错误坐标改过布局了）。
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
  window.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("blur", onBlur);

  return {
    dispose() {
      active = undefined;
      options.container.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("blur", onBlur);
    },
  };
}
