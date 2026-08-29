import { describe, expect, test } from "bun:test";
import {
  BrushSettingsT,
  Color4T,
  DrawingSlotT,
  DrawingT,
  EraserFlagsT,
  EraserSettingsT,
  FrameT,
  GpencilBrushFlagsT,
  GpenT,
  IndexRangeT,
  LayerGroupT,
  LayerT,
  LayerTreeNodeT,
  LassoSettingsT,
  MaterialSlotT,
  Matrix4x4F32T,
  PointFlagsT,
  PointT,
  PressureMappingT,
  StrokeAnchorT,
  StrokeFlagsT,
  StrokeT,
  ToolbarStateT,
  ToolbarToolT,
  ToolReferenceT,
  Vec2T,
  Vec3T,
} from "gpen-protocol/flatbuffers";

import {
  decodeGpen,
  decodeToolbarState,
  encodeGpen,
  encodeToolbarState,
  GpenCodecError,
} from "../src/lib/bindings/flatbuffers/codec";
import { NONE_INDEX } from "../src/lib/bindings/flatbuffers/constants";

/**
 * Build a generated `*T` object from a partial literal. The generated object
 * API uses constructor parameter properties, so plain `Object.assign` over a
 * `new T()` keeps every default and avoids unreadable positional arguments.
 */
function make<T>(ctor: new () => T, init: Record<string, unknown>): T {
  const target = new ctor();
  for (const [key, value] of Object.entries(init)) {
    (target as Record<string, unknown>)[key] = value;
  }
  return target;
}

/** Exact float32 coercion: FlatBuffers f32 accessors round-trip with precision loss otherwise. */
const float32 = (value: number) => new Float32Array([value])[0];

const emptyDocument = make(GpenT, {
  drawings: [],
  nodes: [],
  layers: [],
  groups: [],
  materials: [],
  activeNodeIndex: NONE_INDEX,
  onionSkinningSettings: null,
  flags: null,
  childIndices: [],
});

function completeDocument(): GpenT {
  return make(GpenT, {
    ...emptyDocument,
    drawings: [
      make(DrawingSlotT, {
        drawing: make(DrawingT, {
          type: 0,
          strokes: [
            make(StrokeT, {
              points: [
                make(PointT, {
                  x: 10,
                  y: 20,
                  z: 0,
                  radius: 2,
                  opacity: 1,
                  pressure: 0.75,
                  time: 0,
                  rotation: 0,
                  vertexColor: make(Color4T, { r: 1, g: float32(0.5), b: float32(0.25), a: 1 }),
                  flags: make(PointFlagsT, { selected: false, locked: false, filled: false }),
                  tilt: make(Vec2T, { x: 2, y: -3 }),
                  twist: 45,
                  pointerType: 2,
                  timestamp: 1234.5,
                  miterAngle: 0,
                  handleLeft: null,
                  handleRight: null,
                  handleTypeLeft: 0,
                  handleTypeRight: 0,
                  nurbsWeight: 1,
                }),
              ],
              curveType: 0,
              materialIndex: 0,
              startCap: 0,
              endCap: 1,
              softness: 0,
              fillColor: make(Color4T, { r: 0, g: 0, b: 0, a: 0 }),
              fillId: 0,
              flags: make(StrokeFlagsT, {
                cyclic: false,
                selected: false,
                hidden: false,
                fillVisible: true,
              }),
              id: "stroke-1",
              initTime: 0,
              fillOpacity: 0,
              aspectRatio: 1,
              uScale: 1,
              uvRotation: 0,
              uvTranslation: make(Vec2T, { x: 0, y: 0 }),
              uvScale: make(Vec2T, { x: 1, y: 1 }),
              uTranslation: 0,
              anchor: make(StrokeAnchorT, {
                coordinateSpace: 2,
                documentId: "doc-1",
                framePath: "top",
                transform: make(Matrix4x4F32T, {
                  elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                }),
                scrollOffset: make(Vec2T, { x: 0, y: 0 }),
                devicePixelRatio: 2,
                pageZoom: 1,
              }),
              resolution: 0,
              nurbsOrder: 0,
              nurbsKnotMode: 0,
              customKnots: [],
            }),
          ],
        }),
        reference: null,
      }),
    ],
    nodes: [
      make(LayerTreeNodeT, {
        name: "Root",
        type: 1,
        itemIndex: 0,
        parentIndex: NONE_INDEX,
        color: make(Vec3T, { x: 0, y: 0, z: 0 }),
        flags: null,
      }),
      make(LayerTreeNodeT, {
        name: "Ink",
        type: 0,
        itemIndex: 0,
        parentIndex: 0,
        color: make(Vec3T, { x: float32(0.1), y: float32(0.2), z: float32(0.3) }),
        flags: null,
      }),
    ],
    layers: [
      make(LayerT, {
        name: "Ink",
        type: 0,
        itemIndex: 0,
        parentIndex: 0,
        color: make(Vec3T, { x: float32(0.1), y: float32(0.2), z: float32(0.3) }),
        flags: null,
        frames: [
          make(FrameT, { frameNumber: 1, drawingIndex: 0, type: 0, flags: null, isEnd: false }),
        ],
        masks: [],
        blendMode: 0,
        opacity: 1,
        parent: null,
        transform: null,
        parentInverse: null,
        viewLayerName: "",
        activeMaskIndex: NONE_INDEX,
        passIndex: 0,
        tintColor: null,
        radiusOffset: 0,
      }),
    ],
    groups: [
      make(LayerGroupT, {
        name: "Root",
        type: 1,
        itemIndex: 0,
        parentIndex: NONE_INDEX,
        color: make(Vec3T, { x: 0, y: 0, z: 0 }),
        flags: null,
        childRange: make(IndexRangeT, { start: 0, len: 1 }),
        colorTag: 0,
      }),
    ],
    materials: [
      make(MaterialSlotT, {
        name: "Ink",
        strokeColor: make(Color4T, { r: 0, g: 0, b: 0, a: 1 }),
        fillColor: make(Color4T, { r: 0, g: 0, b: 0, a: 0 }),
        mode: 0,
        flags: null,
      }),
    ],
    activeNodeIndex: 1,
    childIndices: [1],
  });
}

function toolbarState(): ToolbarStateT {
  const kinds = [0, 1, 2, 3, 4];
  return make(ToolbarStateT, {
    tools: kinds.map((kind) =>
      make(ToolbarToolT, {
        id: `tool-${kind}`,
        kind,
        reference: make(ToolReferenceT, {
          idname: `gpen.tool.${kind}`,
          idnameFallback: "",
          idnamePending: "",
          spaceType: 0,
          mode: 0,
        }),
        label: `Tool ${kind}`,
        tooltip: `Tool ${kind}`,
        icon: "circle",
        enabled: kind !== 3,
        keymapId: "",
      }),
    ),
    activeToolId: "tool-0",
    brush: make(BrushSettingsT, {
      size: 4,
      sizeUnit: 0,
      color: make(Color4T, { r: 0, g: 0, b: 0, a: 1 }),
      strength: 1,
      pressureMapping: make(PressureMappingT, { radius: [], opacity: [] }),
      inputSamples: 1,
      spacing: float32(0.1),
      smoothStrokeFactor: 0,
      sizeMin: 1,
      sizeMax: 64,
      presetId: "default",
      drawSmoothFactor: float32(0.5),
      drawSmoothLevels: 1,
      drawSubdivide: 0,
      jitter: 0,
      drawAngle: 0,
      drawAngleFactor: 0,
      hardness: float32(0.5),
      aspectRatio: make(Vec2T, { x: 1, y: 1 }),
      uvRandom: 0,
      capsType: 0,
      curveType: 0,
      simplifyPx: 0,
      vertexMode: 1,
      flags: make(GpencilBrushFlagsT, {
        usePressure: false,
        useStrengthPressure: false,
        useJitterPressure: false,
        stabilizeMouse: false,
        groupSettings: false,
        groupRandom: false,
        materialPinned: false,
        trimStroke: false,
        outlineStroke: false,
        useStroke: false,
        useFill: false,
      }),
    }),
    eraser: make(EraserSettingsT, {
      size: 8,
      sizeUnit: 0,
      strength: 1,
      mode: 0,
      target: 0,
      strengthFactor: 1,
      thicknessFactor: 1,
      flags: make(EraserFlagsT, { occlude: false, keepCaps: false, activeLayerOnly: false }),
    }),
    lasso: make(LassoSettingsT, { enabled: false, mode: 0 }),
    keymaps: [],
  });
}

describe("FlatBuffers codec", () => {
  test("round-trips an empty document and preserves the active sentinel", () => {
    const bytes = encodeGpen(emptyDocument);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(decodeGpen(bytes)).toEqual(emptyDocument);
  });

  test("accepts a non-zero Uint8Array byte offset", () => {
    const bytes = encodeGpen(emptyDocument);
    const backing = new Uint8Array(bytes.length + 8);
    backing.set(bytes, 4);
    expect(decodeGpen(backing.subarray(4))).toEqual(emptyDocument);
  });

  test("round-trips drawing, point, anchor, and nested layer data", () => {
    const document = completeDocument();
    expect(decodeGpen(encodeGpen(document))).toEqual(document);
  });

  test("trusts an invalid DrawingSlot union state after structural encoding", () => {
    const invalid = make(GpenT, {
      ...emptyDocument,
      drawings: [make(DrawingSlotT, { drawing: null, reference: null })],
    });
    expect(() => encodeGpen(invalid)).not.toThrow();
    const decoded = decodeGpen(encodeGpen(invalid));
    expect(decoded.drawings).toHaveLength(1);
    expect(decoded.drawings[0].drawing).toBeNull();
    expect(decoded.drawings[0].reference).toBeNull();
  });

  test("rejects malformed input with a codec error", () => {
    expect(() => decodeGpen(new Uint8Array())).toThrow(GpenCodecError);
  });

  test("accepts a structurally lenient short buffer as the generated default", () => {
    // The flatbuffers TS ByteBuffer is lenient for this input: unpacking
    // produces the generated default object rather than doing semantic checks.
    expect(decodeGpen(new Uint8Array([1, 2, 3]))).toEqual(new GpenT());
  });

  test("round-trips the independent toolbar payload", () => {
    const state = toolbarState();
    expect(decodeToolbarState(encodeToolbarState(state))).toEqual(state);
  });
});
