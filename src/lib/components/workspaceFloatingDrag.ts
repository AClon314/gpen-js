/**
 * 浮窗（floating group）拖动的缩放修正：`zoom ≠ 1` 时**接管**拖动。
 *
 * 为什么不沿用 sash 那套「修正指针坐标再派发」：dockview 的浮窗拖动把
 * `getBoundingClientRect()` 量到的**视觉 px** 当容器 px 用，而且不只是坐标——
 * `offset`（指针落在浮窗内的偏移）也是 rect 相减得来的，紧接着 `setBounds` 的夹取边界
 * 同样是视觉 rect。也就是说 rect 派生的量全都混了单位，只修指针坐标救不回来
 * （实测：uiScale=2 时拖 10px，浮窗跳 1328px）。
 *
 * 所以这里直接自己实现：按下时接住事件（不让 dockview 起拖），移动时按
 * `Δ视觉 px / zoom` 算局部增量、夹在容器局部盒内，写回 `.dv-resize-container` 的
 * `left/top`（`toJSON()` 读的就是这两个 style）。松手后回调让宿主重记一次布局。
 *
 * 代价（写进 docs）：`zoom ≠ 1` 时浮窗失去 dockview 的 shift+拖拽回停靠 / 长按手势，
 * 只剩「拖动位置」；`zoom = 1` 时完全不介入。
 */

import { clamp, floatingLocalBox } from "./workspaceFloatingGeometry.js";

interface ActiveDrag {
  pointerId: number;
  startX: number;
  startY: number;
  zoom: number;
  overlay: HTMLElement;
  baseLeft: number;
  baseTop: number;
  moved: boolean;
}

/** 浮窗当前的**局部**坐标：统一由 `floatingLocalBox` 给出（`bottom/right` 对齐也认）。 */
function localPosition(
  overlay: HTMLElement,
  container: HTMLElement,
): { left: number; top: number } {
  const box = floatingLocalBox(overlay, container);
  return { left: box.left, top: box.top };
}

export interface FloatingDragZoomCorrection {
  dispose(): void;
}

export function installFloatingDragZoomCorrection(options: {
  container: HTMLElement;
  getZoom(): number;
  /** 拖动结束（真的有移动）后回调：宿主用它重记一次布局快照。 */
  onDragEnd?(): void;
}): FloatingDragZoomCorrection {
  let drag: ActiveDrag | undefined;

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    // 专用标题栏（`floatingGroupDragHandle: 'titlebar'`）或 tab 条的空白处。
    const handle = target.closest(".dv-floating-titlebar, .dv-void-container");
    if (!handle) return;
    const overlay = handle.closest<HTMLElement>(".dv-resize-container");
    if (!overlay) return;
    const zoom = options.getZoom();
    if (!Number.isFinite(zoom) || zoom <= 0 || Math.abs(zoom - 1) < 1e-3) return;

    // 接管：别让 dockview 也起拖（它的数学在 zoom ≠ 1 下是错的）。
    event.stopImmediatePropagation();
    event.preventDefault();
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (error) {
      // 指针已经抬起来时 setPointerCapture 会抛；拖动手势本来也不需要它。
      console.debug("[gpen] ignored rejection: floating drag setPointerCapture", error);
      return;
    }
    const base = localPosition(overlay, options.container);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      zoom,
      overlay,
      baseLeft: base.left,
      baseTop: base.top,
      moved: false,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    const current = drag;
    // 自己派发的事件不可能是这里的（这里不派发），`isTrusted` 只是便宜的护栏。
    if (!current || !event.isTrusted || event.pointerId !== current.pointerId) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const { clientWidth, clientHeight } = options.container;
    const overlayWidth = current.overlay.offsetWidth;
    const overlayHeight = current.overlay.offsetHeight;
    const left = clamp(
      current.baseLeft + (event.clientX - current.startX) / current.zoom,
      0,
      Math.max(0, clientWidth - overlayWidth),
    );
    const top = clamp(
      current.baseTop + (event.clientY - current.startY) / current.zoom,
      0,
      Math.max(0, clientHeight - overlayHeight),
    );
    current.moved = true;
    current.overlay.style.left = `${Math.round(left)}px`;
    current.overlay.style.right = "auto";
    current.overlay.style.top = `${Math.round(top)}px`;
    current.overlay.style.bottom = "auto";
  }

  function end(event: { pointerId?: number }): void {
    const current = drag;
    if (!current) return;
    if (event.pointerId !== undefined && event.pointerId !== current.pointerId) return;
    drag = undefined;
    if (current.moved) options.onDragEnd?.();
  }

  const onEnd = (event: Event) => end(event as PointerEvent);
  const onBlur = () => end({});

  options.container.addEventListener("pointerdown", onPointerDown, true);
  // window capture：必须比 dockview 的 pointermove 先看到事件。
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onEnd, true);
  window.addEventListener("pointercancel", onEnd, true);
  window.addEventListener("blur", onBlur);

  return {
    dispose() {
      drag = undefined;
      options.container.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
      window.removeEventListener("blur", onBlur);
    },
  };
}
