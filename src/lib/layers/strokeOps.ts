/**
 * Stroke write path: turn sampled pointer input (in layer-local coordinates)
 * into protocol data and append it to the active drawable layer.
 *
 * This is the minimal write path (T4) — no eraser, no fill, no pressure curve,
 * no multi-frame timeline, no brush presets. It is pure data: every function
 * returns a new document and never mutates its input, so it composes with the
 * undo snapshot stack in `components/GpenWorkspace.svelte` and can be unit
 * tested without a DOM.
 *
 * Where a stroke lives (protocol `gpen.tsp` / `drawing.tsp` / `layer.tsp`):
 *
 *   Gpen.drawings: DrawingSlot[]     <- the stroke payload lives here
 *   Layer.frames:  Frame[]           <- frame.drawingIndex indexes `drawings`
 *   Drawing.strokes: Stroke[]        <- the actual stroke
 *
 * Writing one stroke therefore means: the active node must be a drawable layer
 * (`mimeType = application/gpen`), that layer must have a frame (frame 0 by
 * default), and `drawings[frame.drawingIndex]` must hold a `Drawing`. Missing
 * frames/drawings are created rather than rejected, so "draw on a fresh web
 * layer document" just works.
 */
import {
  CurveType,
  DrawingSlotT,
  DrawingT,
  FrameT,
  GpenT,
  LayerT,
  LayerTreeNodeKind,
  PointT,
  PointerType,
  StrokeCapType,
  StrokeFlagsT,
  StrokeT,
} from "gpen-protocol/flatbuffers";

import { isDrawableLayer } from "../protocol/defaults";
import type { LayerPoint } from "./layerView";

/** Default point radius in layer-local pixels. */
export const DEFAULT_STROKE_RADIUS = 2;
/** Default point opacity (fully opaque). */
export const DEFAULT_STROKE_OPACITY = 1;
/** Default point pressure for input devices without pressure support. */
export const DEFAULT_STROKE_PRESSURE = 1;

const LAYER_NODE_KIND = LayerTreeNodeKind.LAYER_TREE_NODE_KIND_LAYER_UNSPECIFIED;

/**
 * One sampled point in layer-local coordinates. Everything except `x`/`y` is
 * optional and falls back to the stroke-level default.
 */
export interface StrokePointInput {
  x: number;
  y: number;
  z?: number;
  radius?: number;
  opacity?: number;
  pressure?: number;
  /** Seconds from the start of the stroke (protocol `Point.time`). */
  time?: number;
  /** DOM `PointerEvent.pointerType` normalized to the protocol enum. */
  pointerType?: PointerType;
  /** Source timestamp in milliseconds (`PointerEvent.timeStamp`). */
  timestamp?: number;
}

export interface CreateStrokeOptions {
  /** Stable stroke id; generated when omitted. */
  id?: string;
  /** Seconds (protocol `Stroke.init_time`); defaults to 0. */
  initTime?: number;
  curveType?: CurveType;
  materialIndex?: number;
  /** Point radius default; per-point `radius` wins. */
  radius?: number;
  opacity?: number;
  pressure?: number;
  softness?: number;
  startCap?: StrokeCapType;
  endCap?: StrokeCapType;
  fillOpacity?: number;
}

export interface AppendStrokeOptions {
  /** Timeline frame to draw on; defaults to frame 0. */
  frameNumber?: number;
}

let fallbackIdCounter = 0;

/**
 * Stable, unique stroke id. `crypto.randomUUID` when available, otherwise a
 * process-local counter (stable ids are used for incremental rendering and
 * undo, but uniqueness only has to hold within one document/session).
 */
export function nextStrokeId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  fallbackIdCounter += 1;
  return `stroke-${fallbackIdCounter}`;
}

function createPoint(
  input: StrokePointInput,
  defaults: { radius: number; opacity: number; pressure: number },
): PointT {
  return Object.assign(new PointT(), {
    x: input.x,
    y: input.y,
    z: input.z ?? 0,
    radius: input.radius ?? defaults.radius,
    opacity: input.opacity ?? defaults.opacity,
    pressure: input.pressure ?? defaults.pressure,
    time: input.time ?? 0,
    rotation: 0,
    vertexColor: null,
    flags: null,
    tilt: null,
    twist: 0,
    pointerType: input.pointerType ?? PointerType.POINTER_TYPE_UNKNOWN_UNSPECIFIED,
    timestamp: input.timestamp ?? 0,
    miterAngle: 0,
    handleLeft: null,
    handleRight: null,
    nurbsWeight: 1,
  });
}

/**
 * Build a `StrokeT` from layer-local point samples.
 *
 * Defaults follow the handoff: radius ~2, pressure 1, opacity 1, softness 0,
 * round caps, polyline curve (the renderer draws straight segments, so `POLY`
 * is the honest wire value).
 */
export function createStroke(
  points: readonly StrokePointInput[],
  options: CreateStrokeOptions = {},
): StrokeT {
  const defaults = {
    radius: options.radius ?? DEFAULT_STROKE_RADIUS,
    opacity: options.opacity ?? DEFAULT_STROKE_OPACITY,
    pressure: options.pressure ?? DEFAULT_STROKE_PRESSURE,
  };
  return Object.assign(new StrokeT(), {
    points: points.map((point) => createPoint(point, defaults)),
    curveType: options.curveType ?? CurveType.CURVE_TYPE_POLY,
    materialIndex: options.materialIndex ?? 0,
    startCap: options.startCap ?? StrokeCapType.STROKE_CAP_TYPE_ROUND_UNSPECIFIED,
    endCap: options.endCap ?? StrokeCapType.STROKE_CAP_TYPE_ROUND_UNSPECIFIED,
    softness: options.softness ?? 0,
    fillColor: null,
    fillId: 0,
    flags: Object.assign(new StrokeFlagsT(), {
      cyclic: false,
      selected: false,
      hidden: false,
      fillVisible: false,
    }),
    id: options.id ?? nextStrokeId(),
    initTime: options.initTime ?? 0,
    fillOpacity: options.fillOpacity ?? 0,
    aspectRatio: 1,
    uScale: 1,
    uvRotation: 0,
    uvTranslation: null,
    uvScale: null,
    uTranslation: 0,
    anchor: null,
    resolution: 0,
    nurbsOrder: 0,
    customKnots: [],
  });
}

/**
 * Return the active layer if it is a drawable layer, otherwise `undefined`.
 * Used by renderers to decide whether the canvas has a real target.
 */
export function activeDrawableLayer(document: GpenT): LayerT | undefined {
  const node = document.nodes[document.activeNodeIndex];
  if (!node || node.type !== LAYER_NODE_KIND) return undefined;
  const layer = document.layers[node.itemIndex];
  return layer && isDrawableLayer(layer) ? layer : undefined;
}

/**
 * Append a stroke to the active drawable layer and return a new document.
 *
 * Throws `RangeError` when the active node is not a drawable layer: the UI
 * must call `layerOps.ensureDrawableActiveLayer` first (the workspace does).
 * Missing frame / drawing slot are created; nothing is mutated in place, and
 * untouched parts of the document are shared by reference.
 */
export function appendStroke(
  document: GpenT,
  stroke: StrokeT,
  options: AppendStrokeOptions = {},
): GpenT {
  const activeNode = document.nodes[document.activeNodeIndex];
  if (!activeNode || activeNode.type !== LAYER_NODE_KIND) {
    throw new RangeError(`active node ${document.activeNodeIndex} is not a layer`);
  }
  const layerIndex = activeNode.itemIndex;
  const layer = document.layers[layerIndex];
  if (!layer) {
    throw new RangeError(`active node ${document.activeNodeIndex} has no layer payload`);
  }
  if (!isDrawableLayer(layer)) {
    throw new RangeError(
      `layer ${layerIndex} (${textValue(layer.name)}) is not drawable; call ensureDrawableActiveLayer first`,
    );
  }

  const frameNumber = normalizeFrameNumber(options.frameNumber);
  const framePosition = layer.frames.findIndex((frame) => frame.frameNumber === frameNumber);
  let drawings = document.drawings;
  let frames = layer.frames;
  let drawingIndex: number;

  if (framePosition >= 0) {
    drawingIndex = frames[framePosition].drawingIndex;
  } else {
    drawingIndex = drawings.length;
    frames = [...frames, Object.assign(new FrameT(), { frameNumber, drawingIndex, isEnd: false })];
  }

  drawings = ensureDrawing(drawings, drawingIndex);
  const drawing = drawings[drawingIndex].drawing;
  if (!drawing) {
    // `ensureDrawing` guarantees a drawing; this keeps the type narrowing honest.
    throw new RangeError(`drawing slot ${drawingIndex} has no drawing payload`);
  }
  const nextDrawing = Object.assign(new DrawingT(), drawing, {
    strokes: [...drawing.strokes, stroke],
  });
  drawings = drawings.map((slot, index) =>
    index === drawingIndex
      ? Object.assign(new DrawingSlotT(), slot, { drawing: nextDrawing })
      : slot,
  );

  const layers = document.layers.map((candidate, index) =>
    index === layerIndex ? Object.assign(new LayerT(), candidate, { frames }) : candidate,
  );

  return Object.assign(new GpenT(), document, { drawings, layers });
}

/**
 * Strokes of one layer in draw order.
 *
 * Frames are visited in ascending `frameNumber`; a drawing referenced by more
 * than one frame is only emitted once (Blender lets several frames share one
 * drawing, and rendering it twice would double the ink).
 */
export function strokesOfLayer(document: GpenT, layer: LayerT): StrokeT[] {
  const frames = [...layer.frames].sort((a, b) => a.frameNumber - b.frameNumber);
  const seen = new Set<number>();
  const strokes: StrokeT[] = [];
  for (const frame of frames) {
    const drawingIndex = frame.drawingIndex;
    if (seen.has(drawingIndex)) continue;
    seen.add(drawingIndex);
    const drawing = document.drawings[drawingIndex]?.drawing;
    if (drawing) strokes.push(...drawing.strokes);
  }
  return strokes;
}

/** All strokes of every drawable layer, in `document.layers` order. */
export function strokesOfDocument(document: GpenT): StrokeT[] {
  const strokes: StrokeT[] = [];
  for (const layer of document.layers) {
    if (isDrawableLayer(layer)) strokes.push(...strokesOfLayer(document, layer));
  }
  return strokes;
}

/** Grow the drawings array up to `drawingIndex` and guarantee a `Drawing` there. */
function ensureDrawing(drawings: GpenT["drawings"], drawingIndex: number): GpenT["drawings"] {
  const slot = drawings[drawingIndex];
  if (slot?.drawing) return drawings;

  const next = [...drawings];
  while (next.length <= drawingIndex) next.push(Object.assign(new DrawingSlotT(), {}));
  next[drawingIndex] = Object.assign(new DrawingSlotT(), slot ?? {}, {
    drawing: new DrawingT(),
    reference: null,
  });
  return next;
}

function normalizeFrameNumber(frameNumber: number | undefined): number {
  if (frameNumber === undefined) return 0;
  if (!Number.isFinite(frameNumber)) {
    throw new RangeError(`frame number must be finite, got ${String(frameNumber)}`);
  }
  return Math.trunc(frameNumber);
}

function textValue(value: string | Uint8Array | null): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}

/**
 * Eraser core (T11): pure geometry plus the STROKE / SOFT / HARD erase paths.
 *
 * The semantics follow Blender's `EraserMode` (the names are misleading, see
 * the handoff and `erase.cc`):
 *
 *  - STROKE (`eraseStrokes`) — `stroke_eraser()`: delete every stroke whose
 *    polyline comes within `radius` of the brush center.
 *  - SOFT (`eraseSoft`) — `soft_eraser()`: lower each point's `opacity` by a
 *    smoothstep falloff of its distance to the brush center; points at or below
 *    `opacity_threshold` (0.05) are dropped.
 *  - HARD (`eraseHard`) — `hard_eraser()`: cut the parts of the polyline that
 *    lie inside the brush circle and keep the outside runs as new strokes.
 *
 * All of them are pure: the input document is never mutated, untouched
 * strokes / drawings / slots are shared by reference, and only the active
 * drawable layer is touched (`active_layer_only`). Erasing on a non-drawable
 * (web) layer is a no-op rather than an error, because the pointer stream may
 * still be live while the active node changes.
 */

/** Blender's `opacity_threshold`: SOFT erasing drops points at or below this. */
export const SOFT_ERASE_OPACITY_THRESHOLD = 0.05;

/** Squared distance from `(px, py)` to the segment `a -> b` (no square root). */
function distanceToSegmentSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    // Degenerate (zero-length) segment: fall back to the point distance.
    const ox = px - ax;
    const oy = py - ay;
    return ox * ox + oy * oy;
  }
  // Projection parameter clamped to the segment, so the nearest point of a
  // segment is never the foot of the perpendicular outside `[a, b]`.
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ox = px - cx;
  const oy = py - cy;
  return ox * ox + oy * oy;
}

/**
 * Shortest distance from `point` to a stroke's polyline, in layer-local units.
 *
 * A single-point stroke is a point; a multi-point stroke is a chain of
 * segments (distance to the *segment*, not to the infinite line), and a
 * zero-length segment degenerates to a point distance instead of producing
 * `0 / 0` NaN. Squared distances are compared and only the winner is rooted.
 * An empty stroke has no ink and reports `Infinity`.
 */
export function distanceToStroke(stroke: StrokeT, point: LayerPoint): number {
  const points = stroke.points;
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y);

  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const squared = distanceToSegmentSquared(
      previous.x,
      previous.y,
      current.x,
      current.y,
      point.x,
      point.y,
    );
    if (squared < best) best = squared;
  }
  return Math.sqrt(best);
}

/** Strokes whose polyline passes within `radius` of `point` (tangency hits). */
export function strokesHitByCircle(
  strokes: readonly StrokeT[],
  point: LayerPoint,
  radius: number,
): StrokeT[] {
  return strokes.filter((stroke) => distanceToStroke(stroke, point) <= radius);
}

/** Map one stroke to zero, one or many replacement strokes. */
type StrokeMapper = (stroke: StrokeT) => readonly StrokeT[];

/**
 * Replace the strokes of `layer` through `map`, sharing everything untouched.
 *
 * A drawing can be referenced by several frames, so frames are walked once per
 * unique `drawingIndex` and the replacement is written back to
 * `document.drawings[i].drawing.strokes`. Slots that do not change (including
 * drawings whose strokes all map to themselves) keep their identity, and the
 * whole document is returned by reference when nothing changed.
 */
function mapLayerStrokes(document: GpenT, layer: LayerT, map: StrokeMapper): GpenT {
  const drawingIndices = new Set<number>();
  for (const frame of layer.frames) drawingIndices.add(frame.drawingIndex);
  if (drawingIndices.size === 0) return document;

  let changed = false;
  const drawings = document.drawings.map((slot, index) => {
    if (!drawingIndices.has(index)) return slot;
    const drawing = slot.drawing;
    if (!drawing) return slot;

    const strokes: StrokeT[] = [];
    let drawingChanged = false;
    for (const stroke of drawing.strokes) {
      const next = map(stroke);
      if (next.length !== 1 || next[0] !== stroke) drawingChanged = true;
      for (const replacement of next) strokes.push(replacement);
    }
    if (!drawingChanged) return slot;

    changed = true;
    return Object.assign(new DrawingSlotT(), slot, {
      drawing: Object.assign(new DrawingT(), drawing, { strokes }),
    });
  });

  if (!changed) return document;
  return Object.assign(new GpenT(), document, { drawings });
}

/**
 * STROKE eraser: delete every stroke of the active layer that the brush circle
 * hits. Single-point strokes are judged by point distance; a non-drawable
 * active node, or a non-positive `radius`, leaves the document untouched.
 */
export function eraseStrokes(document: GpenT, point: LayerPoint, radius: number): GpenT {
  if (!(radius > 0)) return document;
  const layer = activeDrawableLayer(document);
  if (!layer) return document;

  return mapLayerStrokes(document, layer, (stroke) =>
    distanceToStroke(stroke, point) <= radius ? [] : [stroke],
  );
}

/** Clamp to `[0, 1]`; NaN collapses to 0 so a broken setting is inert. */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * SOFT eraser: lower the opacity of points near the brush center by a
 * smoothstep falloff and drop the ones that fall to the opacity threshold.
 *
 * `falloff = smoothstep(1 - d / radius)` with `d` the distance from the point
 * to the brush center, and `opacity' = clamp(opacity - strength * falloff)`.
 * Points at `d >= radius` are untouched, a stroke whose points all vanish is
 * removed, and `strength = 0` is a no-op.
 */
export function eraseSoft(
  document: GpenT,
  point: LayerPoint,
  radius: number,
  strength: number,
): GpenT {
  if (!(radius > 0)) return document;
  const layer = activeDrawableLayer(document);
  if (!layer) return document;
  const amount = clamp01(strength);
  if (amount === 0) return document;

  return mapLayerStrokes(document, layer, (stroke) => {
    const points: PointT[] = [];
    let changed = false;
    for (const source of stroke.points) {
      const distance = Math.hypot(source.x - point.x, source.y - point.y);
      if (distance >= radius) {
        points.push(source);
        continue;
      }
      const t = clamp01(1 - distance / radius);
      const falloff = t * t * (3 - 2 * t);
      const opacity = clamp01(source.opacity - amount * falloff);
      if (opacity <= SOFT_ERASE_OPACITY_THRESHOLD) {
        changed = true;
        continue;
      }
      changed = true;
      points.push(Object.assign(new PointT(), source, { opacity }));
    }

    if (points.length === 0) return [];
    if (!changed) return [stroke];
    return [Object.assign(new StrokeT(), stroke, { points })];
  });
}

/** Strictly inside the circle (squared, no root). Boundary points are outside. */
function isInsideCircle(point: LayerPoint, center: LayerPoint, radius: number): boolean {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return dx * dx + dy * dy < radius * radius;
}

/**
 * Interior `t` values in `(0, 1)` where the segment `a -> b` crosses the circle.
 * Tangency (`discriminant === 0`) is treated as no crossing: the inside set is
 * a single point, so cutting there would only insert a redundant vertex.
 */
function interiorCircleRoots(
  a: LayerPoint,
  b: LayerPoint,
  center: LayerPoint,
  radius: number,
): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return [];

  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const halfB = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = halfB * halfB - lengthSquared * c;
  if (discriminant <= 0) return [];

  const root = Math.sqrt(discriminant);
  const t0 = (-halfB - root) / lengthSquared;
  const t1 = (-halfB + root) / lengthSquared;
  const roots: number[] = [];
  if (t0 > 0 && t0 < 1) roots.push(t0);
  if (t1 > 0 && t1 < 1) roots.push(t1);
  return roots;
}

/** A point on `a -> b` at `t`, with `radius` / `opacity` lerped and rest copied. */
function interpolatePoint(a: PointT, b: PointT, t: number): PointT {
  return Object.assign(new PointT(), a, {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    radius: a.radius + (b.radius - a.radius) * t,
    opacity: a.opacity + (b.opacity - a.opacity) * t,
  });
}

/** Same polyline geometry (same point count and same `x`/`y` in order). */
function samePolyline(a: readonly PointT[], b: readonly PointT[]): boolean {
  return (
    a.length === b.length &&
    a.every((point, index) => point.x === b[index].x && point.y === b[index].y)
  );
}

/**
 * Split a stroke's polyline into the maximal runs that lie outside the circle.
 *
 * Each segment is cut at its interior circle crossings, every sub-segment is
 * classified by its midpoint, and consecutive outside sub-segments are merged
 * back into runs (sub-segments share boundary point objects, so the merge is
 * exact). A run always has at least two points; an isolated outside point of a
 * multi-point stroke is dropped, matching the "cut the stroke open" model.
 */
function splitStrokeOutsideCircle(stroke: StrokeT, center: LayerPoint, radius: number): PointT[][] {
  const points = stroke.points;
  const subsegments: { a: PointT; b: PointT; inside: boolean }[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const cuts = [0, ...interiorCircleRoots(a, b, center, radius), 1];

    // Cache the interpolated cut points per segment so adjacent sub-segments
    // reference the same object and can be merged by identity.
    const boundary = new Map<number, PointT>();
    const boundaryAt = (t: number): PointT => {
      if (t === 0) return a;
      if (t === 1) return b;
      const cached = boundary.get(t);
      if (cached) return cached;
      const created = interpolatePoint(a, b, t);
      boundary.set(t, created);
      return created;
    };

    for (let cut = 0; cut < cuts.length - 1; cut += 1) {
      const t0 = cuts[cut];
      const t1 = cuts[cut + 1];
      const mid = (t0 + t1) / 2;
      const inside = isInsideCircle(
        { x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid },
        center,
        radius,
      );
      subsegments.push({ a: boundaryAt(t0), b: boundaryAt(t1), inside });
    }
  }

  const sameXY = (p: PointT, q: PointT): boolean => p.x === q.x && p.y === q.y;
  const runs: PointT[][] = [];
  let run: PointT[] | undefined;

  for (const segment of subsegments) {
    if (segment.inside) {
      if (run && run.length >= 2) runs.push(run);
      run = undefined;
      continue;
    }
    if (!run) run = [segment.a];
    else if (!sameXY(run[run.length - 1], segment.a)) run.push(segment.a);
    if (!sameXY(segment.a, segment.b)) run.push(segment.b);
  }
  if (run && run.length >= 2) runs.push(run);
  return runs;
}

/**
 * HARD eraser: cut the inside of the brush circle out of each stroke and keep
 * the outside runs as new strokes (fresh ids). A stroke the circle does not
 * reach is shared by reference, a fully covered stroke disappears, and a
 * single-point stroke survives only while it is outside the circle. A
 * non-positive `radius` (including NaN) leaves the document untouched.
 */
export function eraseHard(document: GpenT, point: LayerPoint, radius: number): GpenT {
  if (!(radius > 0)) return document;
  const layer = activeDrawableLayer(document);
  if (!layer) return document;

  return mapLayerStrokes(document, layer, (stroke) => {
    if (stroke.points.length === 0) return [stroke];
    if (distanceToStroke(stroke, point) > radius) return [stroke];
    if (stroke.points.length === 1) return [];

    const runs = splitStrokeOutsideCircle(stroke, point, radius);
    if (runs.length === 0) return [];
    if (runs.length === 1 && samePolyline(runs[0], stroke.points)) return [stroke];
    return runs.map((points) =>
      Object.assign(new StrokeT(), stroke, { points, id: nextStrokeId() }),
    );
  });
}
