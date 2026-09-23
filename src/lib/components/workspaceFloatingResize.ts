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
 * - `pointermove`：`Δ/zoom` 得到局部增量，按方向拼 `left/top/width/height`，
 *   夹在 `FLOATING_MINIMUM_SIZE` 与容器局部盒之间；
 * - 写 `style.left/top/width/height`，`right/bottom = auto`；松手回调宿主重记布局快照；
 * - `zoom = 1` 时完全不介入（dockview 自己的数学是对的）。
 *
 * 代价（与拖动一样，写进 docs）：`zoom ≠ 1` 时浮窗只能改尺寸，没有 dockview 的
 * 吸附 / 智能参考线。
 */
import { clamp, floatingLocalBox, type FloatingLocalBox } from "./workspaceFloatingGeometry.js";
import { FLOATING_MINIMUM_SIZE } from "./workspaceLayout.js";

type ResizeDirection =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "topleft"
  | "topright"
  | "bottomleft"
  | "bottomright";

const DIRECTION_PATTERN =
  /^dv-resize-handle-(top|bottom|left|right|topleft|topright|bottomleft|bottomright)$/;

interface ActiveResize {
  pointerId: number;
  startX: number;
  startY: number;
  zoom: number;
  overlay: HTMLElement;
  handle: HTMLElement;
  direction: ResizeDirection;
  base: FloatingLocalBox;
  moved: boolean;
}

/**
 * 命中的手柄与方向。手柄是 `.dv-resize-container` 的直接子节点，类名是
 * `dv-resize-handle-<方向>`；用 `closest` 兼容未来可能加的内层元素。
 */
function resizeHandleOf(
  target: Element,
): { handle: HTMLElement; direction: ResizeDirection } | undefined {
  const handle = target.closest<HTMLElement>('[class^="dv-resize-handle"]');
  if (!handle) return undefined;
  for (const className of handle.classList) {
    const match = DIRECTION_PATTERN.exec(className);
    if (match) return { handle, direction: match[1] as ResizeDirection };
  }
  return undefined;
}

/** 按方向把局部盒改到目标尺寸；固定边（左拖时的右边、上拖时的下边）保持不动。 */
function resizedBox(
  base: FloatingLocalBox,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  container: { width: number; height: number },
): FloatingLocalBox {
  const minWidth = FLOATING_MINIMUM_SIZE.width;
  const minHeight = FLOATING_MINIMUM_SIZE.height;
  const right = base.left + base.width;
  const bottom = base.top + base.height;
  let { left, top, width, height } = base;

  if (direction.includes("left")) {
    left = clamp(base.left + dx, 0, Math.max(0, right - minWidth));
    width = right - left;
  } else if (direction.includes("right")) {
    width = clamp(base.width + dx, minWidth, Math.max(minWidth, container.width - base.left));
    left = base.left;
  }

  if (direction.includes("top")) {
    top = clamp(base.top + dy, 0, Math.max(0, bottom - minHeight));
    height = bottom - top;
  } else if (direction.includes("bottom")) {
    height = clamp(base.height + dy, minHeight, Math.max(minHeight, container.height - base.top));
    top = base.top;
  }

  return { left, top, width, height };
}

export interface FloatingResizeZoomCorrection {
  dispose(): void;
}

export function installFloatingResizeZoomCorrection(options: {
  container: HTMLElement;
  getZoom(): number;
  /** resize 结束（真的有移动）后回调：宿主用它重记一次布局快照。 */
  onResizeEnd?(): void;
}): FloatingResizeZoomCorrection {
  let resize: ActiveResize | undefined;

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const hit = resizeHandleOf(target);
    if (!hit) return;
    const overlay = hit.handle.closest<HTMLElement>(".dv-resize-container");
    if (!overlay) return;
    const zoom = options.getZoom();
    if (!Number.isFinite(zoom) || zoom <= 0 || Math.abs(zoom - 1) < 1e-3) return;

    // 接管：dockview 的数学在 zoom ≠ 1 下会把尺寸放大一个 zoom 的平方量级。
    event.stopImmediatePropagation();
    event.preventDefault();
    try {
      hit.handle.setPointerCapture(event.pointerId);
    } catch (error) {
      // 指针已经抬起来时 setPointerCapture 会抛；此时没有可拖的手势。
      console.debug("[gpen] ignored rejection: floating resize setPointerCapture", error);
      return;
    }
    resize = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      zoom,
      overlay,
      handle: hit.handle,
      direction: hit.direction,
      base: floatingLocalBox(overlay, options.container),
      moved: false,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    const current = resize;
    // 自己派发的事件不可能是这里的（这里不派发），`isTrusted` 只是便宜的护栏。
    if (!current || !event.isTrusted || event.pointerId !== current.pointerId) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const dx = (event.clientX - current.startX) / current.zoom;
    const dy = (event.clientY - current.startY) / current.zoom;
    const next = resizedBox(current.base, current.direction, dx, dy, {
      width: options.container.clientWidth,
      height: options.container.clientHeight,
    });
    current.moved = true;
    current.overlay.style.left = `${Math.round(next.left)}px`;
    current.overlay.style.top = `${Math.round(next.top)}px`;
    current.overlay.style.right = "auto";
    current.overlay.style.bottom = "auto";
    current.overlay.style.width = `${Math.round(next.width)}px`;
    current.overlay.style.height = `${Math.round(next.height)}px`;
  }

  function end(event: { pointerId?: number }): void {
    const current = resize;
    if (!current) return;
    if (event.pointerId !== undefined && event.pointerId !== current.pointerId) return;
    resize = undefined;
    if (current.moved) options.onResizeEnd?.();
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
      resize = undefined;
      options.container.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
      window.removeEventListener("blur", onBlur);
    },
  };
}
