/**
 * Pointer-based drag with viewport clamping for a single element.
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
 * While attached it also re-clamps the element into the viewport when the
 * window is resized or the page is zoomed (desktop Ctrl +/- and pinch), so a
 * px position captured at a larger viewport cannot leave the element
 * off-screen.
 *
 * ```svelte
 * <button use:draggable={{ onTap: open, margin: 12, onPositionChange: save }}>
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
   * restored from storage). The action owns the DOM style, so consumers must
   * not also bind `style` to this value.
   */
  position?: DragPosition | null;
  /** Re-clamp into the viewport on resize/zoom. Default `true`. */
  keepInViewport?: boolean;
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

/** Visible viewport size; prefers `visualViewport` so pinch/soft-keyboard are respected. */
export function viewportSize(): ViewportSize {
  const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
  return {
    width: viewport?.width ?? (typeof window === "undefined" ? 0 : window.innerWidth),
    height: viewport?.height ?? (typeof window === "undefined" ? 0 : window.innerHeight),
  };
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
  offsetX: number;
  offsetY: number;
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

  function currentBounds(): DragBounds {
    return boundsFor(node.offsetWidth, viewportSize(), options.margin ?? 0);
  }

  let applied: DragPosition | null = null;

  function writePosition(position: DragPosition): void {
    applied = { x: position.x, y: position.y };
    if (options.apply === false) return;
    node.style.left = `${position.x}px`;
    node.style.top = `${position.y}px`;
    node.style.right = "auto";
    node.style.bottom = "auto";
  }

  /** Apply an external `position` (e.g. state restored after mount). */
  function applyExternalPosition(): void {
    const wanted = options.position;
    if (!wanted || gesture) return;
    if (
      applied &&
      Math.round(applied.x) === Math.round(wanted.x) &&
      Math.round(applied.y) === Math.round(wanted.y)
    ) {
      return;
    }
    writePosition({ x: wanted.x, y: wanted.y });
  }

  function settlePosition(position: DragPosition): void {
    writePosition(position);
    options.onPositionChange?.(position);
  }

  let lastViewport = viewportSize();

  /** Reconcile the element after a resize/zoom (clamp back in, keep edge-hugging). */
  function reconcileViewport(): void {
    if (options.keepInViewport === false || gesture) return;

    const size = node.offsetWidth;
    const margin = options.margin ?? 0;
    const viewport = viewportSize();
    const previous = boundsFor(size, lastViewport, margin);
    const next = boundsFor(size, viewport, margin);
    lastViewport = viewport;

    const rect = node.getBoundingClientRect();
    const resolved = reconcileBoundsPosition(
      { x: rect.left, y: rect.top },
      previous,
      next,
      EDGE_EPSILON,
    );
    if (resolved.x === rect.left && resolved.y === rect.top) return;
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

    const rect = node.getBoundingClientRect();
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
      position: { x: rect.left, y: rect.top },
    };
    capturePointer(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;

    if (!current.moved) {
      const travel = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      if (travel <= (options.threshold ?? DEFAULT_DRAG_THRESHOLD)) return;
      current.moved = true;
      options.onDragStart?.(event);
    }

    current.position = clampToBounds(
      { x: event.clientX - current.offsetX, y: event.clientY - current.offsetY },
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
    viewportListeners.push([window, "resize"]);
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

  // Run once after the initial style has been applied, so an externally
  // restored position is applied and reconciled against the viewport.
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
