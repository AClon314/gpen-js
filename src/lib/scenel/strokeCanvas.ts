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
 * (`src/lib/layers/README.md`), and preventing the wheel would break panning. The
 * canvas only calls `event.preventDefault()` on `pointerdown` so drawing does
 * not turn into a text-selection / click gesture.
 *
 * All coordinates are layer-local. Rendering maps each point back to client
 * coordinates via the layer view, so the ink stays glued to the (possibly
 * rotated) layer, and then translates by the canvas rect to draw.
 *
 * Structure: `createStrokeCanvas` owns the canvas lifecycle (context guard,
 * listeners, observers) and delegates to two families of module-level
 * functions — the drawing primitives (which take an injected 2D context and
 * are unit tested) and the pointer-gesture handlers (which operate on one
 * mutable `StrokeCanvasRuntime`).
 */
import { type StrokeT } from "gpen-protocol/flatbuffers";
import { PointerType } from "gpen-protocol/flatbuffers";

import type { LayerPoint, LayerView } from "../layers/layerView";
import type { StrokePointInput } from "../layers/strokeOps";
import { observeViewport } from "../visualViewport";

/** CSS custom property read for the stroke color (falls back to the token default). */
export const STROKE_COLOR_TOKEN = "--gpen-panel-accent";
/** Fallback stroke color when the token cannot be read (canvas still needs a color). */
export const STROKE_FALLBACK_COLOR = "#4f46e5";
/** Minimum distance between sampled points in client pixels (debounce). */
export const MIN_POINT_DISTANCE = 2;

/** 笔画画布的依赖（画布、笔画源、视图映射、回写回调）。 */
export interface StrokeCanvasDeps {
  canvas: HTMLCanvasElement;
  /** Committed strokes to render, in draw order (recomputed on every redraw). */
  strokes: () => readonly StrokeT[];
  /** Current layer view used for layer-local ↔ client mapping. */
  view: () => LayerView | undefined;
  /** Called once per committed stroke; the caller persists / undoes it. */
  onStroke: (points: StrokePointInput[]) => void;
  /**
   * Called once per sampled erase position while the eraser tool is active.
   * The canvas only reports the layer-local point; the caller owns the
   * document and the erase algorithm (see `GpenWorkspace.commitErase`).
   */
  onErase?: (point: LayerPoint) => void;
  /**
   * Called once when an eraser gesture ends (pointerup / pointercancel).
   * The caller uses it to close the coalesce group so the next drag is a new
   * undo entry.
   */
  onEraseEnd?: () => void;
  /** Active tool; `eraser` turns the pointer stream into erase samples. */
  activeTool?: () => string;
  /** Brush radius in layer-local units (diameter → radius already applied). */
  brushRadius?: () => number;
  /** Brush color as a CSS color; falls back to the `--gpen-*` token. */
  brushColor?: () => string | undefined;
  /** CSS custom property holding the stroke color. */
  colorToken?: string;
  /** Sampling distance in client pixels. */
  minDistance?: number;
}

/** 笔画画布 handle（重绘 / 销毁）。 */
export interface StrokeCanvasHandle {
  /** Repaint committed + in-progress strokes. Call on document / view changes. */
  redraw(): void;
  destroy(): void;
}

/**
 * Mutable per-gesture state of one stroke canvas. Kept in one object so the
 * pointer handlers can stay module-level (and therefore out of
 * `createStrokeCanvas`, which health:gate measures as one function).
 */
interface StrokeCanvasRuntime {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  deps: StrokeCanvasDeps;
  minDistance: number;
  colorToken: string;
  inProgress: StrokePointInput[];
  activePointerId: number | undefined;
  destroyed: boolean;
  /** Eraser: last reported position, so a drag does not spam identical samples. */
  lastErase: LayerPoint | undefined;
  /** Whether the current gesture is an eraser drag (reported on pointer end). */
  gestureWasErase: boolean;
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

/**
 * Pure: fill a dot of `radius` diameter at `point` (a click without a drag, or
 * a single-point stroke). Exported so the drawing primitive can be tested with
 * a fake 2D context.
 */
export function drawDot(
  ctx: CanvasRenderingContext2D,
  point: LayerPoint,
  radius: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(0.5, radius / 2), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Pure: draw a polyline one segment at a time so each point's radius is
 * honored (a single-point list degrades to `drawDot`). Exported for tests.
 */
export function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: readonly LayerPoint[],
  radii: readonly number[],
  color: string,
): void {
  if (points.length === 0) return;
  if (points.length === 1) {
    drawDot(ctx, points[0], radii[0] ?? 2, color);
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

function pointerToClient(event: PointerEvent): LayerPoint {
  return { x: event.clientX, y: event.clientY };
}

function isEraser(runtime: StrokeCanvasRuntime): boolean {
  return runtime.deps.activeTool?.() === "eraser";
}

function toLayer(runtime: StrokeCanvasRuntime, client: LayerPoint): LayerPoint {
  const view = runtime.deps.view();
  return view ? view.toLayerPoint(client) : client;
}

function toClient(runtime: StrokeCanvasRuntime, local: LayerPoint): LayerPoint {
  const view = runtime.deps.view();
  return view ? view.toClientPoint(local) : local;
}

function resolveColor(runtime: StrokeCanvasRuntime): string {
  const explicit = runtime.deps.brushColor?.();
  if (explicit) return explicit;
  const computed =
    typeof getComputedStyle === "function" ? getComputedStyle(runtime.canvas) : undefined;
  const value = computed?.getPropertyValue(runtime.colorToken).trim();
  return value && value.length > 0 ? value : STROKE_FALLBACK_COLOR;
}

/**
 * Size the backing store to the device pixel ratio and make the 2D context
 * draw in client coordinates (translated by the canvas rect).
 */
function prepareCanvas(runtime: StrokeCanvasRuntime): void {
  const { canvas, ctx } = runtime;
  const rect = canvas.getBoundingClientRect();
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.translate(-rect.left, -rect.top);
}

function drawSavedStrokes(runtime: StrokeCanvasRuntime, color: string): void {
  for (const stroke of runtime.deps.strokes()) {
    const points = strokeClientPoints(stroke, (local) => toClient(runtime, local));
    const radii = stroke.points.map((point) => point.radius);
    drawPolyline(runtime.ctx, points, radii, color);
  }
}

function drawInProgress(runtime: StrokeCanvasRuntime, color: string): void {
  const points = runtime.inProgress;
  if (points.length === 0) return;
  const clientPoints = points.map((point) => toClient(runtime, { x: point.x, y: point.y }));
  // 正在画的笔迹用当前画笔半径预览（否则会先按默认 2px 画、落笔后跳变）。
  const previewRadius = runtime.deps.brushRadius?.() ?? 2;
  const radii = points.map((point) => point.radius ?? previewRadius);
  drawPolyline(runtime.ctx, clientPoints, radii, color);
}

function redraw(runtime: StrokeCanvasRuntime): void {
  if (runtime.destroyed) return;
  prepareCanvas(runtime);
  const color = resolveColor(runtime);
  drawSavedStrokes(runtime, color);
  drawInProgress(runtime, color);
}

function samplePointer(runtime: StrokeCanvasRuntime, event: PointerEvent): StrokePointInput {
  const local = toLayer(runtime, pointerToClient(event));
  return {
    x: local.x,
    y: local.y,
    pressure: event.pressure > 0 ? event.pressure : 1,
    pointerType: pointerTypeOf(event),
    timestamp: event.timeStamp,
  };
}

/** Returns `false` when capture was attempted and threw (the caller skips redraw). */
function capturePointer(canvas: HTMLCanvasElement, pointerId: number): boolean {
  if (typeof canvas.setPointerCapture !== "function") return true;
  try {
    canvas.setPointerCapture(pointerId);
    return true;
  } catch (error) {
    // Pointer capture can fail for an already-released pointer; drawing
    // still works without it (moves just stop at the canvas edge).
    console.debug("[gpen] ignored rejection: stroke canvas setPointerCapture", error);
    return false;
  }
}

function releasePointer(canvas: HTMLCanvasElement, pointerId: number): void {
  if (typeof canvas.hasPointerCapture === "function" && canvas.hasPointerCapture(pointerId)) {
    canvas.releasePointerCapture(pointerId);
  }
}

/** Clear the per-gesture fields; `gestureWasErase` is handled by its caller. */
function resetGesture(runtime: StrokeCanvasRuntime): void {
  runtime.inProgress = [];
  runtime.activePointerId = undefined;
  runtime.lastErase = undefined;
}

function startGesture(runtime: StrokeCanvasRuntime, event: PointerEvent): void {
  if (runtime.destroyed) return;
  // Left button / pen contact / touch only; ignore secondary mouse buttons.
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  runtime.activePointerId = event.pointerId;
  runtime.gestureWasErase = isEraser(runtime);
  if (runtime.gestureWasErase) {
    const point = toLayer(runtime, pointerToClient(event));
    runtime.lastErase = point;
    runtime.deps.onErase?.(point);
  } else {
    runtime.inProgress = [samplePointer(runtime, event)];
  }
  if (!capturePointer(runtime.canvas, event.pointerId)) return;
  redraw(runtime);
}

function moveErase(runtime: StrokeCanvasRuntime, event: PointerEvent): void {
  const point = toLayer(runtime, pointerToClient(event));
  // Same debounce as drawing: erase samples closer than `minDistance`
  // would repeat identical hit tests (and identical documents).
  if (runtime.lastErase && distance(point, runtime.lastErase) < runtime.minDistance) return;
  runtime.lastErase = point;
  runtime.deps.onErase?.(point);
  redraw(runtime);
}

function moveStroke(runtime: StrokeCanvasRuntime, event: PointerEvent): void {
  const next = samplePointer(runtime, event);
  const last = runtime.inProgress[runtime.inProgress.length - 1];
  if (last && distance(next, last) < runtime.minDistance) return;
  runtime.inProgress.push(next);
  redraw(runtime);
}

function continueGesture(runtime: StrokeCanvasRuntime, event: PointerEvent): void {
  if (runtime.destroyed || runtime.activePointerId !== event.pointerId) return;
  if (isEraser(runtime)) {
    moveErase(runtime, event);
    return;
  }
  moveStroke(runtime, event);
}

function endGesture(runtime: StrokeCanvasRuntime, event: PointerEvent): void {
  if (runtime.destroyed || runtime.activePointerId !== event.pointerId) return;
  const points = runtime.inProgress;
  resetGesture(runtime);
  if (runtime.gestureWasErase) {
    runtime.gestureWasErase = false;
    runtime.deps.onEraseEnd?.();
  }
  releasePointer(runtime.canvas, event.pointerId);
  // pointerup and pointercancel both commit: a cancelled gesture still made
  // ink the user can see, and dropping it silently would be surprising.
  if (points.length > 0) runtime.deps.onStroke(points);
  redraw(runtime);
}

function bindPointerEvents(runtime: StrokeCanvasRuntime): () => void {
  const { canvas } = runtime;
  const onPointerDown = (event: PointerEvent) => startGesture(runtime, event);
  const onPointerMove = (event: PointerEvent) => continueGesture(runtime, event);
  const onPointerEnd = (event: PointerEvent) => endGesture(runtime, event);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerEnd);
    canvas.removeEventListener("pointercancel", onPointerEnd);
  };
}

/** Watch the canvas box; returns a no-op disposer where ResizeObserver is absent. */
function observeCanvasResize(canvas: HTMLCanvasElement, listener: () => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver(listener);
  observer.observe(canvas);
  return () => observer.disconnect();
}

/** 在给定画布上创建笔画绘制与指针采样。 */
export function createStrokeCanvas(deps: StrokeCanvasDeps): StrokeCanvasHandle {
  const { canvas } = deps;
  const context = canvas.getContext("2d");
  if (!context) {
    console.debug("[gpen] ignored rejection: stroke canvas has no 2d context");
    return { redraw() {}, destroy() {} };
  }

  const runtime: StrokeCanvasRuntime = {
    canvas,
    ctx: context,
    deps,
    minDistance: deps.minDistance ?? MIN_POINT_DISTANCE,
    colorToken: deps.colorToken ?? STROKE_COLOR_TOKEN,
    inProgress: [],
    activePointerId: undefined,
    destroyed: false,
    lastErase: undefined,
    gestureWasErase: false,
  };
  const redrawNow = () => redraw(runtime);
  const unbindPointerEvents = bindPointerEvents(runtime);
  const removeViewportListener = observeViewport(redrawNow);
  const disconnectResize = observeCanvasResize(canvas, redrawNow);

  return {
    redraw: redrawNow,
    destroy() {
      if (runtime.destroyed) return;
      runtime.destroyed = true;
      unbindPointerEvents();
      removeViewportListener();
      disconnectResize();
      resetGesture(runtime);
      runtime.gestureWasErase = false;
    },
  };
}
