/**
 * 浮窗（dockview floating group）的**局部几何**工具 + 缩放手势的公共管道。
 *
 * 为什么需要它：dockview 给浮窗写定位时可能在 `left` / `right`（以及 `top` / `bottom`）
 * 之间切换 —— 拖到容器下半部分就改成 `bottom` 对齐，于是 `style.left/top` 是 `'auto'`。
 * `Number.parseFloat('auto')` = `NaN`，直接拿它做「装不装得下」的判断就会把浮窗误判成越界，
 * 每帧重新落位（923 handoff §0 的回归）。这里把两种对齐都还原成局部盒。
 *
 * 统一入口的第二个好处：拖动（`workspaceFloatingDrag.ts`）、resize
 * （`workspaceFloatingResize.ts`）用同一套坐标定义与几何换算，不用各写一遍
 * `auto` 还原、增量夹取；`workspaceSashZoom.ts` 的指针管道也共用
 * `installZoomGesture`。
 */

import { FLOATING_MINIMUM_SIZE, type LayoutSize } from "./workspaceLayout.js";

/** 容器局部 px 的浮窗盒（`left/top` 永远是有限数）。 */
export interface FloatingLocalBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 容器局部 px 的浮窗左上角。 */
export interface FloatingLocalPoint {
  left: number;
  top: number;
}

/** 二维增量（视觉 px 或局部 px，由调用方约定）。 */
export interface FloatingVector {
  x: number;
  y: number;
}

/** 浮窗 resize 的八个方向（类名后缀同 dockview 的 `.dv-resize-handle-<方向>`）。 */
export type FloatingResizeDirection =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "topleft"
  | "topright"
  | "bottomleft"
  | "bottomright";

/** 把数值夹进 `[min, max]`。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 缩放是否可用：有限、正、且明显不等于 1（`zoom = 1` 时修正器完全不介入）。 */
export function isUsableZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom > 0 && Math.abs(zoom - 1) >= 1e-3;
}

/** 是否主键按下：鼠标只认左键，触屏 / 笔没有 button 语义（按下即有效）。 */
export function isPrimaryPointerPress(event: PointerEvent): boolean {
  return !(event.pointerType === "mouse" && event.button !== 0);
}

/**
 * 接管 `pointerdown` 的公共前奏：先阻止 dockview 起它自己那套（它的数学在
 * `zoom ≠ 1` 下是错的），再对指针做捕获。`label` 只用于捕获失败时的诊断日志。
 *
 * 返回 `false` 表示捕获失败（指针已经抬起来时会抛）——调用方应放弃手势。
 */
export function takeOverPointerDown(
  handle: HTMLElement,
  event: PointerEvent,
  label: string,
): boolean {
  event.stopImmediatePropagation();
  event.preventDefault();
  try {
    handle.setPointerCapture(event.pointerId);
    return true;
  } catch (error) {
    // 指针已经抬起来时 setPointerCapture 会抛；此时没有可拖的手势。
    console.debug(`[gpen] ignored rejection: ${label} setPointerCapture`, error);
    return false;
  }
}

/**
 * 接管 `pointermove` 的公共前奏：忽略自己派发的合成事件，并拦下原事件。
 *
 * `isTrusted === false` 只可能是我们自己派发的修正事件（拖动 / resize 不派发，
 * 所以它只是便宜的护栏）；拦下原事件是为了让 dockview 看不到未经换算的坐标。
 */
export function takeOverPointerMove(event: PointerEvent): boolean {
  if (!event.isTrusted) return false;
  event.stopImmediatePropagation();
  event.preventDefault();
  return true;
}

/** 把浮窗的局部左上角写回 inline style（`right` / `bottom` 归零，避免双重对齐）。 */
export function writeLocalOrigin(overlay: HTMLElement, origin: FloatingLocalPoint): void {
  overlay.style.left = `${Math.round(origin.left)}px`;
  overlay.style.top = `${Math.round(origin.top)}px`;
  overlay.style.right = "auto";
  overlay.style.bottom = "auto";
}

/** 把浮窗的局部尺寸写回 inline style。 */
export function writeLocalSize(overlay: HTMLElement, size: LayoutSize): void {
  overlay.style.width = `${Math.round(size.width)}px`;
  overlay.style.height = `${Math.round(size.height)}px`;
}

/** `parseFloat` 但只接受有限数（`'auto'` / `''` / 乱码都返回 `undefined`）。 */
function finite(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 读浮窗的局部盒。
 *
 * 优先信 inline `left/top`；`auto` 时用 `right/bottom` + 容器尺寸反推
 * （`localLeft = clientWidth - right - width`），最后才退回 `offsetLeft/offsetTop`
 * ——它们都是**局部 px**，`zoom` 不参与（`offsetWidth` / `clientWidth` 同样不受缩放影响）。
 */
export function floatingLocalBox(overlay: HTMLElement, container: HTMLElement): FloatingLocalBox {
  const width = overlay.offsetWidth;
  const height = overlay.offsetHeight;
  const left = finite(overlay.style.left);
  const top = finite(overlay.style.top);
  if (left !== undefined && top !== undefined) return { left, top, width, height };
  const right = finite(overlay.style.right);
  const bottom = finite(overlay.style.bottom);
  return {
    left:
      left ?? (right !== undefined ? container.clientWidth - right - width : overlay.offsetLeft),
    top:
      top ?? (bottom !== undefined ? container.clientHeight - bottom - height : overlay.offsetTop),
    width,
    height,
  };
}

/**
 * 拖动后的浮窗局部左上角。
 *
 * 指针增量是**视觉 px**，除以 `zoom` 换成容器局部 px，再夹在
 * `[0, 容器尺寸 - 浮窗尺寸]` 里（浮窗不能拖出容器；容器装不下时退化成 0）。
 */
export function draggedLocalPosition(
  base: FloatingLocalPoint,
  delta: FloatingVector,
  zoom: number,
  container: LayoutSize,
  size: LayoutSize,
): FloatingLocalPoint {
  return {
    left: clamp(base.left + delta.x / zoom, 0, Math.max(0, container.width - size.width)),
    top: clamp(base.top + delta.y / zoom, 0, Math.max(0, container.height - size.height)),
  };
}

/**
 * resize 后的浮窗局部盒。
 *
 * 按 `direction` 改尺寸，固定边（左拖时的右边、上拖时的下边）保持不动；
 * 尺寸夹在 `FLOATING_MINIMUM_SIZE` 与容器之间，位移夹在容器内。
 */
export function resizedLocalBox(
  base: FloatingLocalBox,
  direction: FloatingResizeDirection,
  delta: FloatingVector,
  container: LayoutSize,
): FloatingLocalBox {
  const minWidth = FLOATING_MINIMUM_SIZE.width;
  const minHeight = FLOATING_MINIMUM_SIZE.height;
  const right = base.left + base.width;
  const bottom = base.top + base.height;
  let { left, top, width, height } = base;

  if (direction.includes("left")) {
    left = clamp(base.left + delta.x, 0, Math.max(0, right - minWidth));
    width = right - left;
  } else if (direction.includes("right")) {
    width = clamp(base.width + delta.x, minWidth, Math.max(minWidth, container.width - base.left));
    left = base.left;
  }

  if (direction.includes("top")) {
    top = clamp(base.top + delta.y, 0, Math.max(0, bottom - minHeight));
    height = bottom - top;
  } else if (direction.includes("bottom")) {
    height = clamp(
      base.height + delta.y,
      minHeight,
      Math.max(minHeight, container.height - base.top),
    );
    top = base.top;
  }

  return { left, top, width, height };
}

/** 缩放手势的公共管道：`pointerdown` 命中 → `pointermove` → 结束（松手 / cancel / blur）。 */
export interface ZoomGestureHandlers<State> {
  /** 按下时（capture 阶段）判定是否接管；返回手势状态，`undefined` 表示不接管。 */
  start(event: PointerEvent): State | undefined;
  /** 匹配上 `pointerId` 的移动；是否过滤 `isTrusted` 由回调自己决定。 */
  move(event: PointerEvent, state: State): void;
  /** 手势结束（松手 / cancel / blur）；`state` 是 `start` 的返回值。 */
  finish?(state: State): void;
}

/** `installZoomGesture` 的选项。 */
export interface ZoomGestureOptions<State> {
  /** 监听 `pointerdown` 的容器（capture 阶段）。 */
  container: HTMLElement;
  handlers: ZoomGestureHandlers<State>;
  /** 右键菜单是否也算结束（sash 需要；拖动 / resize 注册它会改变原行为）。 */
  endOnContextMenu?: boolean;
}

/** 手势句柄：`dispose()` 移除全部监听。 */
export interface ZoomGesture {
  dispose(): void;
}

/**
 * 装上「按下 → 移动 → 结束」的指针管道，三个缩放修正器共用。
 *
 * 为什么要共用：`workspaceFloatingDrag` / `workspaceFloatingResize` / `workspaceSashZoom`
 * 各自抄过一份 `end(pointerId)` + window capture 监听 + dispose，重复代码一度占文件的一半；
 * 差异只在「按下怎么命中、移动怎么换算」，所以把那部分留成回调。
 *
 * 语义与原先逐字一致：`pointerdown` 在 `container` 的 capture 阶段；`pointermove` 在
 * window 的 capture 阶段（必须比 dockview 的 document 监听先看到）；`pointerup` /
 * `pointercancel` / `blur` 结束；`pointerId` 不匹配的移动与结束都忽略。
 */
export function installZoomGesture<State>(options: ZoomGestureOptions<State>): ZoomGesture {
  let state: State | undefined;
  let pointerId: number | undefined;

  function onPointerDown(event: PointerEvent): void {
    const next = options.handlers.start(event);
    if (next === undefined) return;
    state = next;
    pointerId = event.pointerId;
  }

  function onPointerMove(event: PointerEvent): void {
    if (state === undefined) return;
    if (event.pointerId !== pointerId) return;
    options.handlers.move(event, state);
  }

  function end(event: { pointerId?: number }): void {
    if (state === undefined) return;
    // `blur` 没有 pointerId，强制结束；其余只认发起手势的那根指针。
    if (event.pointerId !== undefined && event.pointerId !== pointerId) return;
    const finished = state;
    state = undefined;
    pointerId = undefined;
    options.handlers.finish?.(finished);
  }

  const onEnd = (event: Event) => end(event as PointerEvent);
  const onBlur = () => end({});
  const onContextMenu = () => end({});

  options.container.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onEnd, true);
  window.addEventListener("pointercancel", onEnd, true);
  window.addEventListener("blur", onBlur);
  if (options.endOnContextMenu) window.addEventListener("contextmenu", onContextMenu, true);

  return {
    dispose() {
      state = undefined;
      pointerId = undefined;
      options.container.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
      window.removeEventListener("blur", onBlur);
      if (options.endOnContextMenu) window.removeEventListener("contextmenu", onContextMenu, true);
    },
  };
}
