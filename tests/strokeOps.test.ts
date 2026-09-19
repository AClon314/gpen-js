import { describe, expect, test } from "bun:test";
import { DrawingSlotT, DrawingT, FrameT, GpenT, LayerT, StrokeT } from "gpen-protocol/flatbuffers";

import { createDefaultGpen } from "../src/lib/protocol/defaults";
import { ensureDrawableActiveLayer } from "../src/lib/layers/layerOps";
import {
  activeDrawableLayer,
  appendStroke,
  createStroke,
  DEFAULT_STROKE_PRESSURE,
  DEFAULT_STROKE_RADIUS,
  nextStrokeId,
  strokesOfDocument,
  strokesOfLayer,
} from "../src/lib/layers/strokeOps";

function drawableDocument(): GpenT {
  return ensureDrawableActiveLayer(createDefaultGpen("https://example.com/"));
}

function layerAtActiveNode(document: GpenT): LayerT {
  const node = document.nodes[document.activeNodeIndex];
  const layer = document.layers[node.itemIndex];
  if (!layer) throw new Error("test setup: active node has no layer payload");
  return layer;
}

describe("createStroke", () => {
  test("applies the minimal defaults and keeps layer-local points", () => {
    const stroke = createStroke([
      { x: 1, y: 2 },
      { x: 3, y: 4, radius: 6, pressure: 0.5 },
    ]);

    expect(stroke.points).toHaveLength(2);
    expect(stroke.points[0].x).toBe(1);
    expect(stroke.points[0].y).toBe(2);
    expect(stroke.points[0].z).toBe(0);
    expect(stroke.points[0].radius).toBe(DEFAULT_STROKE_RADIUS);
    expect(stroke.points[0].pressure).toBe(DEFAULT_STROKE_PRESSURE);
    expect(stroke.points[0].opacity).toBe(1);
    // Per-point overrides win over the stroke-level default.
    expect(stroke.points[1].radius).toBe(6);
    expect(stroke.points[1].pressure).toBe(0.5);

    expect(stroke.softness).toBe(0);
    // Round caps are the protocol's 0 (= ROUND_UNSPECIFIED) value.
    expect(stroke.startCap).toBe(0);
    expect(stroke.endCap).toBe(0);
    expect(typeof stroke.id).toBe("string");
    expect(stroke.id).not.toBe("");
  });

  test("generates stable unique ids and accepts an explicit one", () => {
    const generated = new Set([nextStrokeId(), nextStrokeId(), nextStrokeId()]);
    expect(generated.size).toBe(3);
    expect(createStroke([{ x: 0, y: 0 }], { id: "stroke-fixed" }).id).toBe("stroke-fixed");
  });
});

describe("appendStroke", () => {
  test("creates the drawable layer frame and drawing on a fresh document", () => {
    const document = createDefaultGpen("https://example.com/");
    const drawable = drawableDocument();
    const stroke = createStroke([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);

    const next = appendStroke(drawable, stroke);
    const layer = layerAtActiveNode(next);

    // The input is untouched (structural sharing, no in-place mutation).
    expect(drawable.drawings).toHaveLength(0);
    expect(next).not.toBe(drawable);
    expect(document.drawings).toHaveLength(0);

    // Frame 0 was created and points at the new drawing slot.
    expect(layer.frames).toHaveLength(1);
    expect(layer.frames[0].frameNumber).toBe(0);
    expect(layer.frames[0].drawingIndex).toBe(0);

    // The drawing slot exists and holds the stroke.
    expect(next.drawings).toHaveLength(1);
    expect(next.drawings[0].drawing).not.toBeNull();
    expect(next.drawings[0].drawing?.strokes).toHaveLength(1);
    expect(next.drawings[0].drawing?.strokes[0]).toBe(stroke);

    // The web layer (index 0) keeps its empty frame list.
    expect(next.layers[0].frames).toHaveLength(0);
    expect(activeDrawableLayer(next)).toBe(layer);
  });

  test("reuses the existing frame/drawing on the second stroke", () => {
    const document = drawableDocument();
    const first = appendStroke(document, createStroke([{ x: 0, y: 0 }]));
    const second = appendStroke(first, createStroke([{ x: 1, y: 1 }]));

    const layer = layerAtActiveNode(second);
    expect(layer.frames).toHaveLength(1);
    expect(second.drawings).toHaveLength(1);
    expect(second.drawings[0].drawing?.strokes).toHaveLength(2);
  });

  test("honors an explicit frame number", () => {
    const document = drawableDocument();
    const next = appendStroke(document, createStroke([{ x: 0, y: 0 }]), { frameNumber: 7 });

    const layer = layerAtActiveNode(next);
    expect(layer.frames).toHaveLength(1);
    expect(layer.frames[0].frameNumber).toBe(7);
    expect(layer.frames[0].drawingIndex).toBe(0);
  });

  test("refuses to draw on a non-drawable (web) layer", () => {
    const document = createDefaultGpen("https://example.com/");
    expect(() => appendStroke(document, createStroke([{ x: 0, y: 0 }]))).toThrow(RangeError);
    // The rejection must not have created anything.
    expect(document.drawings).toHaveLength(0);
  });
});

describe("strokesOfLayer", () => {
  test("returns strokes in append order", () => {
    const first = appendStroke(drawableDocument(), createStroke([{ x: 0, y: 0 }]));
    const second = appendStroke(first, createStroke([{ x: 1, y: 1 }]));
    const layer = layerAtActiveNode(second);

    const strokes = strokesOfLayer(second, layer);
    expect(strokes).toHaveLength(2);
    expect(strokes[0]).toBe(second.drawings[0].drawing?.strokes[0]);
    expect(strokes[1]).toBe(second.drawings[0].drawing?.strokes[1]);
  });

  test("walks frames by frame number and de-duplicates shared drawings", () => {
    const document = drawableDocument();
    const layer = layerAtActiveNode(document);
    const strokeA = createStroke([{ x: 0, y: 0 }], { id: "a" });
    const strokeB = createStroke([{ x: 1, y: 1 }], { id: "b" });
    // Frame 2 -> drawing 1 (B), frame 0 -> drawing 0 (A), frame 5 -> drawing 0 (A again).
    const withDrawings = Object.assign(new GpenT(), document, {
      drawings: [
        Object.assign(new DrawingSlotT(), {
          drawing: Object.assign(new DrawingT(), { strokes: [strokeA] }),
        }),
        Object.assign(new DrawingSlotT(), {
          drawing: Object.assign(new DrawingT(), { strokes: [strokeB] }),
        }),
      ],
      layers: [
        document.layers[0],
        Object.assign(new LayerT(), layer, {
          frames: [
            Object.assign(new FrameT(), { frameNumber: 2, drawingIndex: 1 }),
            Object.assign(new FrameT(), { frameNumber: 0, drawingIndex: 0 }),
            Object.assign(new FrameT(), { frameNumber: 5, drawingIndex: 0 }),
          ],
        }),
      ],
    });

    const strokes = strokesOfLayer(withDrawings, layerAtActiveNode(withDrawings));
    expect(strokes.map((stroke) => stroke.id)).toEqual(["a", "b"]);
  });

  test("skips slots without a drawing payload", () => {
    const document = Object.assign(new GpenT(), drawableDocument(), {
      drawings: [Object.assign(new DrawingSlotT(), { drawing: null, reference: null })],
      layers: [
        drawableDocument().layers[0],
        Object.assign(new LayerT(), layerAtActiveNode(drawableDocument()), {
          frames: [Object.assign(new FrameT(), { frameNumber: 0, drawingIndex: 0 })],
        }),
      ],
    });

    expect(strokesOfLayer(document, document.layers[1])).toEqual([]);
    expect(strokesOfDocument(document)).toEqual([]);
  });
});

describe("strokesOfDocument", () => {
  test("returns strokes of every drawable layer and ignores web layers", () => {
    const withStroke = appendStroke(drawableDocument(), createStroke([{ x: 0, y: 0 }]));
    const strokes = strokesOfDocument(withStroke);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toBeInstanceOf(StrokeT);
    // The web layer contributes nothing even though it is a layer.
    expect(strokesOfLayer(withStroke, withStroke.layers[0])).toEqual([]);
  });
});
