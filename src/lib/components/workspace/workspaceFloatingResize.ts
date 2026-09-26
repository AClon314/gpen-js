/**
 * 浮窗（floating group）resize 的缩放修正：`zoom ≠ 1` 时**接管**八个方向的手柄。
 *
 * 为什么必须接管：dockview 的 `Overlay.setupResize` 与浮窗拖动是同一套混单位数学
 * ——它用 `getBoundingClientRect()` 量容器与浮窗（**视觉 px**），却把结果写进
 * `style.width/height`（**容器局部 px**）。实测 uiScale=2 时拖 10px，尺寸变化 856px。
 * 改指针坐标救不回来（差值、原始尺寸、夹取边界全是 rect 派生的），所以直接自己算。
 *
 * 做法与 `workspaceFloatingDrag.ts` 对称：
 *
 * - `pointerdown`（container 捕获阶段）命中 `.dv-resize-handle-<方向>` 且 `zoom ≠ 1` 时
 *   `stopImmediatePropagation()`，不让 dockview 起它那套；
 * - 记 `base`（局部盒，`floatingLocalBox` 认 `auto` 对齐）；
 * - `pointermove`：`Δ/zoom` 得到局部增量，按方向拼 `left/top/width/height`
 *   （`resizedLocalBox`），夹在 `FLOATING_MINIMUM_SIZE` 与容器局部盒之间；
 * - 写 `style.left/top/width/height`，`right/bottom = auto`；松手回调宿主重记布局快照；
 * - `zoom = 1` 时完全不介入（dockview 自己的数学是对的）。
 *
 * 代价（与拖动一样，写进 docs）：`zoom ≠ 1` 时浮窗只能改尺寸，没有 dockview 的
 * 吸附 / 智能参考线。
 */
import {
  floatingLocalBox,
  installZoomGesture,
  isPrimaryPointerPress,
  isUsableZoom,
  resizedLocalBox,
  takeOverPointerDown,
  takeOverPointerMove,
  writeLocalOrigin,
  writeLocalSize,
  type FloatingLocalBox,
  type FloatingResizeDirection,
} from "./workspaceFloatingGeometry.js";

const DIRECTION_PATTERN =
  /^dv-resize-handle-(top|bottom|left|right|topleft|topright|bottomleft|bottomright)$/;

interface ActiveResize {
  startX: number;
  startY: number;
  zoom: number;
  overlay: HTMLElement;
  direction: FloatingResizeDirection;
  base: FloatingLocalBox;
  moved: boolean;
}

/**
 * 命中的手柄与方向（鼠标只认主键）。手柄是 `.dv-resize-container` 的直接子节点，类名是
 * `dv-resize-handle-<方向>`；用 `closest` 兼容未来可能加的内层元素。
 */
function resizeHandleOf(
  event: PointerEvent,
): { handle: HTMLElement; direction: FloatingResizeDirection } | undefined {
  if (!isPrimaryPointerPress(event)) return undefined;
  const target = event.target;
  if (!(target instanceof Element)) return undefined;
  const handle = target.closest<HTMLElement>('[class^="dv-resize-handle"]');
  if (!handle) return undefined;
  for (const className of handle.classList) {
    const match = DIRECTION_PATTERN.exec(className);
    if (match) return { handle, direction: match[1] as FloatingResizeDirection };
  }
  return undefined;
}

/** 浮窗 resize 缩放修正器（卸载时 `dispose()`）。 */
export interface FloatingResizeZoomCorrection {
  dispose(): void;
}

/** 缩放 ≠ 1 时接管浮窗 resize，把局部坐标换算回容器坐标。 */
export function installFloatingResizeZoomCorrection(options: {
  container: HTMLElement;
  getZoom(): number;
  /** resize 结束（真的有移动）后回调：宿主用它重记一次布局快照。 */
  onResizeEnd?(): void;
}): FloatingResizeZoomCorrection {
  return installZoomGesture<ActiveResize>({
    container: options.container,
    handlers: {
      start(event) {
        const hit = resizeHandleOf(event);
        if (!hit) return undefined;
        const overlay = hit.handle.closest<HTMLElement>(".dv-resize-container");
        if (!overlay) return undefined;
        const zoom = options.getZoom();
        if (!isUsableZoom(zoom)) return undefined;

        // 接管：dockview 的数学在 zoom ≠ 1 下会把尺寸放大一个 zoom 的平方量级。
        if (!takeOverPointerDown(hit.handle, event, "floating resize")) return undefined;
        return {
          startX: event.clientX,
          startY: event.clientY,
          zoom,
          overlay,
          direction: hit.direction,
          base: floatingLocalBox(overlay, options.container),
          moved: false,
        };
      },
      move(event, resize) {
        if (!takeOverPointerMove(event)) return;
        const next = resizedLocalBox(
          resize.base,
          resize.direction,
          {
            x: (event.clientX - resize.startX) / resize.zoom,
            y: (event.clientY - resize.startY) / resize.zoom,
          },
          { width: options.container.clientWidth, height: options.container.clientHeight },
        );
        resize.moved = true;
        writeLocalOrigin(resize.overlay, next);
        writeLocalSize(resize.overlay, next);
      },
      finish(resize) {
        if (resize.moved) options.onResizeEnd?.();
      },
    },
  });
}
