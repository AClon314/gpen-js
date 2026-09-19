/**
 * Pointer-based drag with viewport clamping for a single floating element.
 *
 * Extracted from `GpenOverlay`'s floating-ball handling so any element can be
 * dragged (with tap detection and bounds clamping) without pulling in a heavy
 * drag/resize library.
 *
 * The action uses pointer capture, so it keeps receiving moves outside the
 * element and works for mouse, touch and pen. It sets `touch-action: none` on
 * the node (restored on destroy) and writes the resolved position to
 * `node.style` (disable with `apply: false` to handle positioning yourself,
 * e.g. by reading `onPositionChange`).
 *
 * ## 坐标语义（手机 pinch 缩放的关键）
 *
 * - action 存的位置、`onPositionChange` 报出去的位置，都是**视觉视口坐标**：
 *   相对 `visualViewport` 左上角。这正是用户看到的位置，所以「贴右下角」在 pinch
 *   缩放 / 旋转 / 软键盘之后依然成立，存进 storage 的也是这个语义。
 * - 写进 DOM 的 `left/top` 由 `anchor` 决定，两者都在补上「视觉视口相对参考系的偏移」，
 *   否则元素会跟着布局视口走：pinch 放大后视觉视口只是布局视口里的一小块，
 *   元素看起来就是"被错误地固定住"甚至跑出可视区。
 *   - `'fixed'`（默认）：元素是 `position: fixed`，补 `visualViewport.offsetLeft/offsetTop`；
 *   - `'page'`：元素是 `position: absolute`，补 `visualViewport.pageLeft/pageTop`（文档坐标，
 *     和 `GpenOverlay` 的 overlay 同款，跨浏览器最稳）。
 * - 视觉视口平移（pinch-pan）时只重写样式让元素跟着走，位置值不变，因此不会反复写存储。
 * - `keepInViewport`（默认开）会在视口尺寸变化时把元素夹回可视区，并保持"贴边"意图。
 *
 * ```svelte
 * <button use:draggable={{ onTap: open, margin: 12, anchor: 'page', onPositionChange: save }}>
 *   …
 * </button>
 * ```
 */
import type { Action } from "svelte/action";

export interface DragPosition {
  x: number;
  y: number;
}

/** Allowed top-left positions for the dragged element (already size-aware). */
export interface DragBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface DraggableOptions {
  /** Movement (CSS px) before a gesture counts as a drag instead of a tap. */
  threshold?: number;
  /** Gap (CSS px) kept between the element and the viewport edges. */
  margin?: number;
  /** Write the resolved position to `node.style` (left/top). Default `true`. */
  apply?: boolean;
  /**
   * Position to apply on mount and whenever it changes externally (e.g. one
   * restored from storage). Visual-viewport coordinates. `null` / `undefined`
   * parks the element in the bottom-right corner. The action owns the DOM
   * style, so consumers must not also bind `style` to this value.
   */
  position?: DragPosition | null;
  /** Re-clamp into the viewport on resize/zoom. Default `true`. */
  keepInViewport?: boolean;
  /** 见文件头的坐标语义。Default `'fixed'`. */
  anchor?: "fixed" | "page";
  /** Pointer released without exceeding `threshold`. */
  onTap?: (event: PointerEvent) => void;
  /** Gesture exceeded `threshold` and is now dragging. */
  onDragStart?: (event: PointerEvent) => void;
  /** Called on every move with the clamped top-left position. */
  onDrag?: (position: DragPosition, event: PointerEvent) => void;
  /** Drag finished, with the final top-left position. */
  onDragEnd?: (position: DragPosition, event: PointerEvent) => void;
  /** Called whenever the action settles on a position (drag end / re-clamp). */
  onPositionChange?: (position: DragPosition) => void;
}

export const DEFAULT_DRAG_THRESHOLD = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function visualViewport(): VisualViewport | null | undefined {
  return typeof window === "undefined" ? undefined : window.visualViewport;
}

/** Visible viewport size; prefers `visualViewport` so pinch/soft-keyboard are respected. */
export function viewportSize(): ViewportSize {
  const viewport = visualViewport();
  return {
    width: viewport?.width ?? (typeof window === "undefined" ? 0 : window.innerWidth),
    height: viewport?.height ?? (typeof window === "undefined" ? 0 : window.innerHeight),
  };
}

/**
 * 视觉视口相对**布局视口**的偏移：`position: fixed` 的元素要补它。
 * 未缩放时为 (0, 0)，pinch 放大后平移就会出现非零值。
 */
export function visualViewportOffset(): DragPosition {
  const viewport = visualViewport();
  return { x: viewport?.offsetLeft ?? 0, y: viewport?.offsetTop ?? 0 };
}

/**
 * 视觉视口相对**文档原点**的偏移：`position: absolute` 的元素要补它。
 * `pageLeft/pageTop` 已经把页面滚动和 pinch 平移都算进去了。
 */
export function pageOffset(): DragPosition {
  const viewport = visualViewport();
  return {
    x: viewport?.pageLeft ?? (typeof window === "undefined" ? 0 : window.scrollX),
    y: viewport?.pageTop ?? (typeof window === "undefined" ? 0 : window.scrollY),
  };
}

/** 视觉视口坐标 → 写进 DOM 的坐标（两个参考系只差一个偏移）。 */
export function offsetPosition(position: DragPosition, offset: DragPosition): DragPosition {
  return { x: position.x + offset.x, y: position.y + offset.y };
}

/** Size-aware bounds keeping a `size`×`size` element inside the viewport. */
export function boundsFor(size: number, viewport: ViewportSize, margin = 0): DragBounds {
  return {
    minX: margin,
    minY: margin,
    maxX: Math.max(margin, viewport.width - size - margin),
    maxY: Math.max(margin, viewport.height - size - margin),
  };
}

export function clampToBounds(position: DragPosition, bounds: DragBounds): DragPosition {
  return {
    x: clamp(position.x, bounds.minX, bounds.maxX),
    y: clamp(position.y, bounds.minY, bounds.maxY),
  };
}

export const EDGE_EPSILON = 1;

/**
 * Resolve a position after the viewport changed.
 *
 * `left`/`top` are absolute, so a mid-screen position stays put (clamped back
 * inside if needed). But a position glued to the right/bottom edge must keep
 * hugging that edge when the viewport grows — otherwise zooming out would
 * detach it. The edge check is done against the *previous* bounds.
 */
export function reconcileBoundsPosition(
  position: DragPosition,
  previous: DragBounds,
  next: DragBounds,
  epsilon = EDGE_EPSILON,
): DragPosition {
  const clamped = clampToBounds(position, next);
  return {
    x: Math.abs(position.x - previous.maxX) <= epsilon ? next.maxX : clamped.x,
    y: Math.abs(position.y - previous.maxY) <= epsilon ? next.maxY : clamped.y,
  };
}

interface DragGesture {
  pointerId: number;
  startX: number;
  startY: number;
  start: DragPosition;
  moved: boolean;
  position: DragPosition;
}

export const draggable: Action<HTMLElement, DraggableOptions | undefined> = (
  node,
  initialOptions,
) => {
  let options: DraggableOptions = initialOptions ?? {};
  let gesture: DragGesture | undefined;

  const previousTouchAction = node.style.touchAction;
  node.style.touchAction = "none";

  function margin(): number {
    return options.margin ?? 0;
  }

  function currentBounds(): DragBounds {
    return boundsFor(node.offsetWidth, viewportSize(), margin());
  }

  /**
   * 元素当前的视觉视口坐标。
   *
   * 优先用 action 自己写下去的 `applied`，**不要**用 `getBoundingClientRect()` 现算：
   * DOM 里的 left/top 是按**上一次**的参考系写的，偏移一变（pinch 平移、页面滚动），
   * 用新偏移去读旧坐标会得到错的值 —— 于是"贴右下角"的状态被判成"随便摆的"，
   * 缩回去时元素就停在中途而不是贴回原来的边。
   */
  function currentVisualPosition(): DragPosition {
    if (applied) return { x: applied.x, y: applied.y };
    const rect = node.getBoundingClientRect();
    const offset = visualViewportOffset();
    return { x: rect.left - offset.x, y: rect.top - offset.y };
  }

  /** action 自己写下去的视觉视口位置（DOM 只是它的投影）。 */
  let applied: DragPosition | null = null;

  /** 没有存过位置时的默认位置：可视区右下角。 */
  function cornerPosition(): DragPosition {
    const bounds = boundsFor(node.offsetWidth, viewportSize(), margin());
    return { x: bounds.maxX, y: bounds.maxY };
  }

  function domOffset(): DragPosition {
    return options.anchor === "page" ? pageOffset() : visualViewportOffset();
  }

  function writePosition(position: DragPosition): void {
    applied = { x: position.x, y: position.y };
    if (options.apply === false) return;
    const dom = offsetPosition(position, domOffset());
    node.style.left = `${dom.x}px`;
    node.style.top = `${dom.y}px`;
    node.style.right = "auto";
    node.style.bottom = "auto";
  }

  /** Apply the external `position` (or the corner default) if it changed. */
  function applyExternalPosition(): void {
    if (gesture) return;
    const wanted = options.position ?? cornerPosition();
    if (
      applied &&
      Math.round(applied.x) === Math.round(wanted.x) &&
      Math.round(applied.y) === Math.round(wanted.y)
    ) {
      return;
    }
    writePosition(wanted);
  }

  function settlePosition(position: DragPosition): void {
    writePosition(position);
    options.onPositionChange?.(position);
  }

  let lastViewport = viewportSize();
  // 记的是"写进 DOM 用"的偏移：`anchor: 'page'` 时它随页面滚动变化（球要跟着页面滚，
  // 才能一直贴在看得见的那块区域的角上），`anchor: 'fixed'` 时只有 pinch 平移才会变。
  let lastOffset = domOffset();

  /**
   * 视口变化时重新安置元素：
   * - 尺寸变了（pinch 缩放、旋转、软键盘、桌面 Ctrl+/-）：夹回可视区，并保持贴边意图；
   * - 只是参考系偏移变了（pinch-pan / 页面滚动）：位置值不变，但 DOM 坐标要跟着重写，
   *   否则元素会停在旧参考系里、看起来被"错误固定"。
   */
  function reconcileViewport(): void {
    const previousViewport = lastViewport;
    const previousOffset = lastOffset;
    const viewport = viewportSize();
    const offset = domOffset();
    lastViewport = viewport;
    lastOffset = offset;

    const viewportChanged =
      viewport.width !== previousViewport.width || viewport.height !== previousViewport.height;
    const offsetChanged = offset.x !== previousOffset.x || offset.y !== previousOffset.y;
    if (!viewportChanged && !offsetChanged) return;
    if (gesture) return;

    const current = currentVisualPosition();
    if (!viewportChanged) {
      writePosition(current);
      return;
    }

    const next = boundsFor(node.offsetWidth, viewport, margin());
    const resolved =
      options.keepInViewport === false
        ? current
        : reconcileBoundsPosition(
            current,
            boundsFor(node.offsetWidth, previousViewport, margin()),
            next,
            EDGE_EPSILON,
          );

    if (resolved.x === current.x && resolved.y === current.y) {
      // 值没变：offset 变了就重写一次样式（元素要跟着视觉视口走），否则什么都不用做。
      if (offsetChanged) writePosition(current);
      return;
    }
    settlePosition(resolved);
  }

  function capturePointer(pointerId: number): void {
    try {
      node.setPointerCapture(pointerId);
    } catch (error) {
      console.debug("[gpen] ignored rejection: draggable setPointerCapture", error);
      return;
    }
  }

  function releasePointer(pointerId: number): void {
    try {
      node.releasePointerCapture(pointerId);
    } catch (error) {
      console.debug("[gpen] ignored rejection: draggable releasePointerCapture", error);
      return;
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const start = currentVisualPosition();
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start,
      moved: false,
      position: start,
    };
    capturePointer(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;

    // 用位移而不是「client - 元素位置」：位移在不同浏览器 / 不同缩放状态下都一致，
    // 绝对坐标则要看 clientX 的参考系（视觉视口 vs 布局视口）是否和 rect 一致。
    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;

    if (!current.moved) {
      if (Math.hypot(deltaX, deltaY) <= (options.threshold ?? DEFAULT_DRAG_THRESHOLD)) return;
      current.moved = true;
      options.onDragStart?.(event);
    }

    current.position = clampToBounds(
      { x: current.start.x + deltaX, y: current.start.y + deltaY },
      currentBounds(),
    );
    writePosition(current.position);
    options.onDrag?.(current.position, event);
  }

  function handlePointerEnd(event: PointerEvent): void {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture = undefined;
    releasePointer(event.pointerId);

    if (!current.moved) {
      options.onTap?.(event);
      return;
    }

    options.onDragEnd?.(current.position, event);
    options.onPositionChange?.(current.position);
  }

  const viewportListeners: Array<[EventTarget, string]> = [];
  if (typeof window !== "undefined") {
    // window scroll 只在 `anchor: 'page'` 下会改变偏移，但订阅成本极低，
    // 两个 anchor 共用一条注册路径（reconcile 自己判断有没有真的变化）。
    viewportListeners.push([window, "resize"], [window, "scroll"]);
    const viewport = window.visualViewport;
    if (viewport) viewportListeners.push([viewport, "resize"], [viewport, "scroll"]);
  }
  for (const [target, type] of viewportListeners) {
    target.addEventListener(type, reconcileViewport);
  }

  node.addEventListener("pointerdown", handlePointerDown);
  node.addEventListener("pointermove", handlePointerMove);
  node.addEventListener("pointerup", handlePointerEnd);
  node.addEventListener("pointercancel", handlePointerEnd);

  // 先立即安置一次（此时可能还没完成布局，尺寸按 0 算），再在下一帧按真实尺寸修正，
  // 这样首屏不会先闪现在左上角。
  applyExternalPosition();
  const initialClamp = requestAnimationFrame(() => {
    applyExternalPosition();
    reconcileViewport();
  });

  return {
    update(next: DraggableOptions | undefined) {
      options = next ?? {};
      applyExternalPosition();
    },
    destroy() {
      cancelAnimationFrame(initialClamp);
      for (const [target, type] of viewportListeners) {
        target.removeEventListener(type, reconcileViewport);
      }
      node.removeEventListener("pointerdown", handlePointerDown);
      node.removeEventListener("pointermove", handlePointerMove);
      node.removeEventListener("pointerup", handlePointerEnd);
      node.removeEventListener("pointercancel", handlePointerEnd);
      node.style.touchAction = previousTouchAction;
    },
  };
};
