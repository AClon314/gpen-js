/**
 * Stroke construction: turn sampled pointer input (layer-local coordinates)
 * into protocol `StrokeT` data.
 *
 * This is the "input" stage of the stroke write path (see `docs/stroke.md`).
 * Everything here is pure: no document is read or written, so the builders can
 * be unit tested without a DOM or a `GpenT`.
 */
import {
  CurveType,
  PointT,
  PointerType,
  StrokeCapType,
  StrokeFlagsT,
  StrokeT,
} from "gpen-protocol/flatbuffers";

/** Default point radius in layer-local pixels. */
export const DEFAULT_STROKE_RADIUS = 2;
/** Default point opacity (fully opaque). */
export const DEFAULT_STROKE_OPACITY = 1;
/** Default point pressure for input devices without pressure support. */
export const DEFAULT_STROKE_PRESSURE = 1;

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

/** 新建笔画时的可选参数（id、材质、半径、透明度、端点等）。 */
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
