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

import {
  draggedLocalPosition,
  floatingLocalBox,
  installZoomGesture,
  isPrimaryPointerPress,
  isUsableZoom,
  takeOverPointerDown,
  takeOverPointerMove,
  writeLocalOrigin,
} from "./workspaceFloatingGeometry.js";

interface ActiveDrag {
  startX: number;
  startY: number;
  zoom: number;
  overlay: HTMLElement;
  baseLeft: number;
  baseTop: number;
  moved: boolean;
}

/** 命中浮窗拖动把手并读出当前缩放；不满足接管条件时返回 `undefined`。 */
function dragHandleOf(
  event: PointerEvent,
  getZoom: () => number,
): { handle: HTMLElement; overlay: HTMLElement; zoom: number } | undefined {
  if (!isPrimaryPointerPress(event)) return undefined;
  const target = event.target;
  if (!(target instanceof Element)) return undefined;
  // 专用标题栏（`floatingGroupDragHandle: 'titlebar'`）或 tab 条的空白处。
  const handle = target.closest<HTMLElement>(".dv-floating-titlebar, .dv-void-container");
  if (!handle) return undefined;
  const overlay = handle.closest<HTMLElement>(".dv-resize-container");
  if (!overlay) return undefined;
  const zoom = getZoom();
  if (!isUsableZoom(zoom)) return undefined;
  return { handle, overlay, zoom };
}

/** 浮窗拖动缩放修正器（卸载时 `dispose()`）。 */
export interface FloatingDragZoomCorrection {
  dispose(): void;
}

/** 缩放 ≠ 1 时接管浮窗拖动，把局部坐标换算回容器坐标。 */
export function installFloatingDragZoomCorrection(options: {
  container: HTMLElement;
  getZoom(): number;
  /** 拖动结束（真的有移动）后回调：宿主用它重记一次布局快照。 */
  onDragEnd?(): void;
}): FloatingDragZoomCorrection {
  return installZoomGesture<ActiveDrag>({
    container: options.container,
    handlers: {
      start(event) {
        const hit = dragHandleOf(event, options.getZoom);
        if (!hit) return undefined;
        // 接管：别让 dockview 也起拖（它的数学在 zoom ≠ 1 下是错的）。
        if (!takeOverPointerDown(hit.handle, event, "floating drag")) return undefined;
        const base = floatingLocalBox(hit.overlay, options.container);
        return {
          startX: event.clientX,
          startY: event.clientY,
          zoom: hit.zoom,
          overlay: hit.overlay,
          baseLeft: base.left,
          baseTop: base.top,
          moved: false,
        };
      },
      move(event, drag) {
        if (!takeOverPointerMove(event)) return;
        const next = draggedLocalPosition(
          { left: drag.baseLeft, top: drag.baseTop },
          { x: event.clientX - drag.startX, y: event.clientY - drag.startY },
          drag.zoom,
          { width: options.container.clientWidth, height: options.container.clientHeight },
          { width: drag.overlay.offsetWidth, height: drag.overlay.offsetHeight },
        );
        drag.moved = true;
        writeLocalOrigin(drag.overlay, next);
      },
      finish(drag) {
        if (drag.moved) options.onDragEnd?.();
      },
    },
  });
}
