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
