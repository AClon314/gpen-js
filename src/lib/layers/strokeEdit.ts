/**
 * Stroke edits: the write / transform stage of the stroke path.
 *
 * `appendStroke` appends freshly sampled input to the active drawable layer,
 * and the eraser core implements Blender's three `EraserMode`s:
 *
 *  - STROKE (`eraseStrokes`) — delete every stroke whose polyline comes within
 *    `radius` of the brush center.
 *  - SOFT (`eraseSoft`) — lower each point's `opacity` by a smoothstep falloff
 *    of its distance to the brush center; points at or below
 *    `opacity_threshold` (0.05) are dropped.
 *  - HARD (`eraseHard`) — cut the parts of the polyline that lie inside the
 *    brush circle and keep the outside runs as new strokes.
 *
 * All of them are pure: the input document is never mutated, untouched
 * strokes / drawings / slots are shared by reference, and only the active
 * drawable layer is touched (`active_layer_only`). Erasing on a non-drawable
 * (web) layer is a no-op rather than an error, because the pointer stream may
 * still be live while the active node changes.
 */
import {
  DrawingSlotT,
  DrawingT,
  FrameT,
  GpenT,
  LayerT,
  LayerTreeNodeKind,
  PointT,
  StrokeT,
} from "gpen-protocol/flatbuffers";

import { isDrawableLayer } from "../protocol/defaults";
import type { LayerPoint } from "./layerView";
import { nextStrokeId } from "./strokeCreate";
import { distanceToStroke, splitStrokeOutsideCircle } from "./strokeGeometry";
import { activeDrawableLayer } from "./strokeQuery";

const LAYER_NODE_KIND = LayerTreeNodeKind.LAYER_TREE_NODE_KIND_LAYER_UNSPECIFIED;

/** Blender's `opacity_threshold`: SOFT erasing drops points at or below this. */
export const SOFT_ERASE_OPACITY_THRESHOLD = 0.05;

/** 往笔画追加点时的时间轴帧号。 */
export interface AppendStrokeOptions {
  /** Timeline frame to draw on; defaults to frame 0. */
  frameNumber?: number;
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

/** Validate the active node and return its layer index plus payload. */
function requireDrawableActiveLayer(document: GpenT): { layerIndex: number; layer: LayerT } {
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
  return { layerIndex, layer };
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

/**
 * Resolve (or create) the frame `frameNumber` points at. A missing frame gets
 * the next free drawing slot; an existing one keeps its slot.
 */
function ensureFrame(
  layer: LayerT,
  frameNumber: number,
  drawingCount: number,
): { frames: FrameT[]; drawingIndex: number } {
  const position = layer.frames.findIndex((frame) => frame.frameNumber === frameNumber);
  if (position >= 0) {
    return { frames: layer.frames, drawingIndex: layer.frames[position].drawingIndex };
  }
  const drawingIndex = drawingCount;
  const frame = Object.assign(new FrameT(), { frameNumber, drawingIndex, isEnd: false });
  return { frames: [...layer.frames, frame], drawingIndex };
}

/** Return a copy of `drawings` with `stroke` appended to slot `drawingIndex`. */
function appendStrokeToSlot(
  drawings: GpenT["drawings"],
  drawingIndex: number,
  stroke: StrokeT,
): GpenT["drawings"] {
  const next = ensureDrawing(drawings, drawingIndex);
  const drawing = next[drawingIndex].drawing;
  if (!drawing) {
    // `ensureDrawing` guarantees a drawing; this keeps the type narrowing honest.
    throw new RangeError(`drawing slot ${drawingIndex} has no drawing payload`);
  }
  const nextDrawing = Object.assign(new DrawingT(), drawing, {
    strokes: [...drawing.strokes, stroke],
  });
  return next.map((slot, index) =>
    index === drawingIndex
      ? Object.assign(new DrawingSlotT(), slot, { drawing: nextDrawing })
      : slot,
  );
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
  const { layerIndex, layer } = requireDrawableActiveLayer(document);
  const frameNumber = normalizeFrameNumber(options.frameNumber);
  const { frames, drawingIndex } = ensureFrame(layer, frameNumber, document.drawings.length);
  const drawings = appendStrokeToSlot(document.drawings, drawingIndex, stroke);
  const layers = document.layers.map((candidate, index) =>
    index === layerIndex ? Object.assign(new LayerT(), candidate, { frames }) : candidate,
  );

  return Object.assign(new GpenT(), document, { drawings, layers });
}

/** Map one stroke to zero, one or many replacement strokes. */
type StrokeMapper = (stroke: StrokeT) => readonly StrokeT[];

/** Map the strokes of one drawing; `undefined` when nothing changed. */
function mapDrawingStrokes(drawing: DrawingT, map: StrokeMapper): DrawingT | undefined {
  const strokes: StrokeT[] = [];
  let changed = false;
  for (const stroke of drawing.strokes) {
    const next = map(stroke);
    if (next.length !== 1 || next[0] !== stroke) changed = true;
    for (const replacement of next) strokes.push(replacement);
  }
  if (!changed) return undefined;
  return Object.assign(new DrawingT(), drawing, { strokes });
}

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

    const nextDrawing = mapDrawingStrokes(drawing, map);
    if (!nextDrawing) return slot;
    changed = true;
    return Object.assign(new DrawingSlotT(), slot, { drawing: nextDrawing });
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

/** Smoothstep falloff weight of a point `distance` away from the brush center. */
function softFalloff(distance: number, radius: number): number {
  const t = clamp01(1 - distance / radius);
  return t * t * (3 - 2 * t);
}

/**
 * Erase one point: `undefined` drops it, a different object is the rewritten
 * point, and the original object is returned untouched at `distance >= radius`.
 */
function eraseSoftPoint(
  source: PointT,
  point: LayerPoint,
  radius: number,
  amount: number,
): PointT | undefined {
  const distance = Math.hypot(source.x - point.x, source.y - point.y);
  if (distance >= radius) return source;
  const opacity = clamp01(source.opacity - amount * softFalloff(distance, radius));
  if (opacity <= SOFT_ERASE_OPACITY_THRESHOLD) return undefined;
  return Object.assign(new PointT(), source, { opacity });
}

/** SOFT eraser mapper for one stroke; returns `[stroke]` when no point moved. */
function eraseSoftStroke(
  stroke: StrokeT,
  point: LayerPoint,
  radius: number,
  amount: number,
): StrokeT[] {
  let changed = false;
  const points: PointT[] = [];
  for (const source of stroke.points) {
    const next = eraseSoftPoint(source, point, radius, amount);
    if (next !== source) changed = true;
    if (next) points.push(next);
  }

  if (points.length === 0) return [];
  if (!changed) return [stroke];
  return [Object.assign(new StrokeT(), stroke, { points })];
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

  return mapLayerStrokes(document, layer, (stroke) =>
    eraseSoftStroke(stroke, point, radius, amount),
  );
}

/** Same polyline geometry (same point count and same `x`/`y` in order). */
function samePolyline(a: readonly PointT[], b: readonly PointT[]): boolean {
  return (
    a.length === b.length &&
    a.every((point, index) => point.x === b[index].x && point.y === b[index].y)
  );
}

/** HARD eraser mapper for one stroke (fresh ids on the outside runs). */
function eraseHardStroke(stroke: StrokeT, point: LayerPoint, radius: number): StrokeT[] {
  if (stroke.points.length === 0) return [stroke];
  if (distanceToStroke(stroke, point) > radius) return [stroke];
  if (stroke.points.length === 1) return [];

  const runs = splitStrokeOutsideCircle(stroke, point, radius);
  if (runs.length === 0) return [];
  if (runs.length === 1 && samePolyline(runs[0], stroke.points)) return [stroke];
  return runs.map((points) => Object.assign(new StrokeT(), stroke, { points, id: nextStrokeId() }));
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

  return mapLayerStrokes(document, layer, (stroke) => eraseHardStroke(stroke, point, radius));
}
