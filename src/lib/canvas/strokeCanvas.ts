/**
 * Stroke canvas: the drawing surface that lives inside the viewport hole.
 *
 * Responsibilities (T4, minimal):
 * - own the pointer stream on the viewport (down / move / up / cancel),
 * - map client coordinates into layer-local coordinates through the
 *   `LayerView` mapping and sample at a minimum distance,
 * - render the committed strokes plus the stroke currently being drawn.
 *
 * It deliberately does **not** touch the wheel: the camera is native scrolling
 * (`docs/layer-view.md`), and preventing the wheel would break panning. The
 * canvas only calls `event.preventDefault()` on `pointerdown` so drawing does
 * not turn into a text-selection / click gesture.
 *
 * All coordinates are layer-local. Rendering maps each point back to client
 * coordinates via the layer view, so the ink stays glued to the (possibly
 * rotated) layer, and then translates by the canvas rect to draw.
 */
import { type StrokeT } from "gpen-protocol/flatbuffers";
import { PointerType } from "gpen-protocol/flatbuffers";

import type { LayerPoint, LayerView } from "../layers/layerView";
import { createStroke, type StrokePointInput } from "../layers/strokeOps";
import { observeViewport } from "../visualViewport";

/** CSS custom property read for the stroke color (falls back to the token default). */
export const STROKE_COLOR_TOKEN = "--gpen-panel-accent";
/** Fallback stroke color when the token cannot be read (canvas still needs a color). */
export const STROKE_FALLBACK_COLOR = "#4f46e5";
/** Minimum distance between sampled points in client pixels (debounce). */
export const MIN_POINT_DISTANCE = 2;

export interface StrokeCanvasDeps {
  canvas: HTMLCanvasElement;
  /** Committed strokes to render, in draw order (recomputed on every redraw). */
  strokes: () => readonly StrokeT[];
  /** Current layer view used for layer-local ↔ client mapping. */
  view: () => LayerView | undefined;
  /** Called once per committed stroke; the caller persists / undoes it. */
  onStroke: (stroke: StrokeT) => void;
  /** CSS custom property holding the stroke color. */
  colorToken?: string;
  /** Sampling distance in client pixels. */
  minDistance?: number;
}

export interface StrokeCanvasHandle {
  /** Repaint committed + in-progress strokes. Call on document / view changes. */
  redraw(): void;
  destroy(): void;
}

/**
 * Pure: map one stroke's points to client coordinates through `toClient`.
 * Exported for unit tests (rendering geometry is separated from the DOM).
 */
export function strokeClientPoints(
  stroke: StrokeT,
  toClient: (point: LayerPoint) => LayerPoint,
): LayerPoint[] {
  return stroke.points.map((point) => toClient({ x: point.x, y: point.y }));
}

/** Pure: distance between two points. */
export function distance(a: LayerPoint, b: LayerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createStrokeCanvas(deps: StrokeCanvasDeps): StrokeCanvasHandle {
  const { canvas } = deps;
  const context = canvas.getContext("2d");
  if (!context) {
    console.debug("[gpen] ignored rejection: stroke canvas has no 2d context");
    return { redraw() {}, destroy() {} };
  }
  const ctx = context;
  const minDistance = deps.minDistance ?? MIN_POINT_DISTANCE;
  const colorToken = deps.colorToken ?? STROKE_COLOR_TOKEN;

  let inProgress: StrokePointInput[] = [];
  let activePointerId: number | undefined;
  let destroyed = false;

  const toLayer = (client: LayerPoint): LayerPoint => {
    const view = deps.view();
    return view ? view.toLayerPoint(client) : client;
  };
  const toClient = (local: LayerPoint): LayerPoint => {
    const view = deps.view();
    return view ? view.toClientPoint(local) : local;
  };

  function resolveColor(): string {
    const computed = typeof getComputedStyle === "function" ? getComputedStyle(canvas) : undefined;
    const value = computed?.getPropertyValue(colorToken).trim();
    return value && value.length > 0 ? value : STROKE_FALLBACK_COLOR;
  }

  /**
   * Size the backing store to the device pixel ratio and make the 2D context
   * draw in client coordinates. Returns the canvas client rect (the caller
   * needs it to translate).
   */
  function prepare(): DOMRect {
    const rect = canvas.getBoundingClientRect();
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.translate(-rect.left, -rect.top);
    return rect;
  }

  function drawDot(point: LayerPoint, radius: number, color: string): void {
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(0.5, radius / 2), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** Draw a polyline, one segment at a time so each point's radius is honored. */
  function drawPolyline(
    points: readonly LayerPoint[],
    radii: readonly number[],
    color: string,
  ): void {
    if (points.length === 0) return;
    if (points.length === 1) {
      drawDot(points[0], radii[0] ?? 2, color);
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const radius = ((radii[index - 1] ?? 2) + (radii[index] ?? 2)) / 2;
      ctx.beginPath();
      ctx.lineWidth = Math.max(0.5, radius);
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(current.x, current.y);
      ctx.stroke();
    }
  }

  function drawSaved(strokes: readonly StrokeT[], color: string): void {
    for (const stroke of strokes) {
      const points = strokeClientPoints(stroke, toClient);
      const radii = stroke.points.map((point) => point.radius);
      drawPolyline(points, radii, color);
    }
  }

  function drawInProgress(color: string): void {
    if (inProgress.length === 0) return;
    const points = inProgress.map((point) => toClient({ x: point.x, y: point.y }));
    const radii = inProgress.map((point) => point.radius ?? 2);
    drawPolyline(points, radii, color);
  }

  function redraw(): void {
    if (destroyed) return;
    prepare();
    const color = resolveColor();
    drawSaved(deps.strokes(), color);
    drawInProgress(color);
  }

  function sample(event: PointerEvent): StrokePointInput {
    const local = toLayer({ x: event.clientX, y: event.clientY });
    return {
      x: local.x,
      y: local.y,
      pressure: event.pressure > 0 ? event.pressure : 1,
      pointerType: pointerTypeOf(event),
      timestamp: event.timeStamp,
    };
  }

  function onPointerDown(event: PointerEvent): void {
    if (destroyed) return;
    // Left button / pen contact / touch only; ignore secondary mouse buttons.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    inProgress = [sample(event)];
    if (typeof canvas.setPointerCapture === "function") {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture can fail for an already-released pointer; drawing
        // still works without it (moves just stop at the canvas edge).
        console.debug("[gpen] ignored rejection: stroke canvas setPointerCapture", error);
        return;
      }
    }
    redraw();
  }

  function onPointerMove(event: PointerEvent): void {
    if (destroyed || activePointerId !== event.pointerId) return;
    const next = sample(event);
    const last = inProgress[inProgress.length - 1];
    if (last && distance(next, last) < minDistance) return;
    inProgress.push(next);
    redraw();
  }

  function onPointerEnd(event: PointerEvent): void {
    if (destroyed || activePointerId !== event.pointerId) return;
    const points = inProgress;
    inProgress = [];
    activePointerId = undefined;
    if (
      typeof canvas.hasPointerCapture === "function" &&
      canvas.hasPointerCapture(event.pointerId)
    ) {
      canvas.releasePointerCapture(event.pointerId);
    }
    // pointerup and pointercancel both commit: a cancelled gesture still made
    // ink the user can see, and dropping it silently would be surprising.
    if (points.length > 0) deps.onStroke(createStroke(points));
    redraw();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  const removeViewportListener = observeViewport(redraw);
  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => redraw());
    resizeObserver.observe(canvas);
  }

  return {
    redraw,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      removeViewportListener();
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      inProgress = [];
      activePointerId = undefined;
    },
  };
}

function pointerTypeOf(event: PointerEvent): PointerType {
  switch (event.pointerType) {
    case "mouse":
      return PointerType.POINTER_TYPE_MOUSE;
    case "pen":
      return PointerType.POINTER_TYPE_PEN;
    case "touch":
      return PointerType.POINTER_TYPE_TOUCH;
    default:
      return PointerType.POINTER_TYPE_UNKNOWN_UNSPECIFIED;
  }
}
