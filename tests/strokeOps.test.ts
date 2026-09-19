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
  distanceToStroke,
  eraseHard,
  eraseSoft,
  eraseStrokes,
  nextStrokeId,
  SOFT_ERASE_OPACITY_THRESHOLD,
  strokesHitByCircle,
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

/** Append `strokes` to the active drawable layer, in order. */
function documentWithStrokes(...strokes: StrokeT[]): GpenT {
  return strokes.reduce((document, stroke) => appendStroke(document, stroke), drawableDocument());
}

describe("distanceToStroke", () => {
  test("a single-point stroke measures point-to-point distance", () => {
    const stroke = createStroke([{ x: 3, y: 4 }]);
    expect(distanceToStroke(stroke, { x: 0, y: 0 })).toBe(5);
    expect(distanceToStroke(stroke, { x: 3, y: 4 })).toBe(0);
  });

  test("an empty stroke has no ink and reports Infinity", () => {
    expect(distanceToStroke(createStroke([]), { x: 0, y: 0 })).toBe(Infinity);
  });

  test("measures to the segment, not to the infinite line", () => {
    const horizontal = createStroke([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    // Perpendicular foot is inside the segment.
    expect(distanceToStroke(horizontal, { x: 5, y: 3 })).toBeCloseTo(3, 10);
    // Beyond the end: the nearest point is the endpoint, not the line's foot.
    expect(distanceToStroke(horizontal, { x: 20, y: 0 })).toBeCloseTo(10, 10);
    expect(distanceToStroke(horizontal, { x: -4, y: 0 })).toBeCloseTo(4, 10);

    const diagonal = createStroke([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
    ]);
    // Foot of (3, 0) on the diagonal is (1.08, 1.44).
    expect(distanceToStroke(diagonal, { x: 3, y: 0 })).toBeCloseTo(Math.hypot(1.92, -1.44), 10);
  });

  test("a zero-length segment degenerates to a point distance without NaN", () => {
    const degenerate = createStroke([
      { x: 2, y: 2 },
      { x: 2, y: 2 },
      { x: 5, y: 2 },
    ]);
    const distance = distanceToStroke(degenerate, { x: 2, y: 5 });
    expect(Number.isNaN(distance)).toBe(false);
    expect(distance).toBeCloseTo(3, 10);
  });

  test("returns the closest of several segments", () => {
    const polyline = createStroke([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(distanceToStroke(polyline, { x: 12, y: 10 })).toBeCloseTo(2, 10);
    expect(distanceToStroke(polyline, { x: 5, y: 1 })).toBeCloseTo(1, 10);
  });
});

describe("strokesHitByCircle", () => {
  test("hits inside, misses outside and counts tangency (d == radius)", () => {
    const near = createStroke([{ x: 0, y: 0 }], { id: "near" });
    const far = createStroke([{ x: 10, y: 0 }], { id: "far" });

    expect(strokesHitByCircle([near, far], { x: 1, y: 0 }, 1).map((s) => s.id)).toEqual(["near"]);
    expect(strokesHitByCircle([near, far], { x: 5, y: 0 }, 1)).toEqual([]);
    // Tangency: distance is exactly the radius, which still hits.
    expect(strokesHitByCircle([near], { x: 2, y: 0 }, 2).map((s) => s.id)).toEqual(["near"]);
  });
});

describe("eraseStrokes (STROKE)", () => {
  test("deletes whole strokes inside the radius and keeps the rest by reference", () => {
    const doomed = createStroke([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const kept = createStroke([
      { x: 100, y: 100 },
      { x: 110, y: 100 },
    ]);
    const document = documentWithStrokes(doomed, kept);

    const next = eraseStrokes(document, { x: 5, y: 0 }, 3);
    const strokes = strokesOfLayer(next, layerAtActiveNode(next));
    expect(strokes).toHaveLength(1);
    // Untouched stroke keeps its identity (structural sharing, no rebuild).
    expect(strokes[0]).toBe(kept);
    expect(next.drawings[0]).not.toBe(document.drawings[0]);

    // The input document is untouched.
    expect(document.drawings[0].drawing?.strokes).toHaveLength(2);
  });

  test("deletes a single-point stroke whose point is in range", () => {
    const document = documentWithStrokes(createStroke([{ x: 4, y: 0 }]));
    expect(
      strokesOfLayer(eraseStrokes(document, { x: 0, y: 0 }, 4), layerAtActiveNode(document)),
    ).toHaveLength(0);
  });

  test("returns the document unchanged when nothing is hit", () => {
    const document = documentWithStrokes(createStroke([{ x: 50, y: 50 }]));
    expect(eraseStrokes(document, { x: 0, y: 0 }, 5)).toBe(document);
  });

  test("is a no-op on a non-drawable (web) layer document", () => {
    const web = createDefaultGpen("https://example.com/");
    expect(eraseStrokes(web, { x: 0, y: 0 }, 10)).toBe(web);
  });

  test("treats a non-positive radius as an empty brush", () => {
    const document = documentWithStrokes(createStroke([{ x: 0, y: 0 }]));
    expect(eraseStrokes(document, { x: 0, y: 0 }, 0)).toBe(document);
    expect(eraseStrokes(document, { x: 0, y: 0 }, Number.NaN)).toBe(document);
  });
});

describe("eraseSoft (SOFT)", () => {
  test("lowers the center point more than the edge point", () => {
    const stroke = createStroke([
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 10, y: 0 },
    ]);
    const document = documentWithStrokes(stroke);

    const next = eraseSoft(document, { x: 0, y: 0 }, 10, 0.5);
    const points = strokesOfLayer(next, layerAtActiveNode(next))[0].points;
    // Center: falloff = 1 -> 1 - 0.5. Edge (d = 9): falloff = smoothstep(0.1).
    expect(points[0].opacity).toBeCloseTo(0.5, 10);
    expect(points[1].opacity).toBeCloseTo(1 - 0.5 * 0.028, 10);
    expect(points[0].opacity).toBeLessThan(points[1].opacity);
    // d >= radius is not touched at all (same object).
    expect(points[2]).toBe(stroke.points[2]);
    expect(points[2].opacity).toBe(1);
  });

  test("drops points that fall to the opacity threshold and removes empty strokes", () => {
    const stroke = createStroke([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    const document = documentWithStrokes(stroke);

    // Full strength: the center drops to 0 (<= 0.05) and is removed.
    const next = eraseSoft(document, { x: 0, y: 0 }, 4, 1);
    const strokes = strokesOfLayer(next, layerAtActiveNode(next));
    expect(strokes).toHaveLength(1);
    expect(strokes[0].points.map((point) => point.x)).toEqual([5]);

    // A single point at the center disappears entirely.
    const single = documentWithStrokes(createStroke([{ x: 0, y: 0 }]));
    expect(
      strokesOfLayer(eraseSoft(single, { x: 0, y: 0 }, 4, 1), layerAtActiveNode(single)),
    ).toHaveLength(0);
    expect(SOFT_ERASE_OPACITY_THRESHOLD).toBe(0.05);
  });

  test("strength = 0 leaves the document semantically unchanged", () => {
    const document = documentWithStrokes(createStroke([{ x: 1, y: 1 }]));
    const next = eraseSoft(document, { x: 1, y: 1 }, 10, 0);
    expect(next).toBe(document);
    expect(strokesOfLayer(next, layerAtActiveNode(next))[0].points[0].opacity).toBe(1);
  });

  test("clamps an out-of-range strength and keeps untouched strokes by reference", () => {
    const affected = createStroke([{ x: 0, y: 0 }]);
    const untouched = createStroke([{ x: 100, y: 0 }]);
    const document = documentWithStrokes(affected, untouched);

    const next = eraseSoft(document, { x: 0, y: 0 }, 5, 5);
    const strokes = strokesOfLayer(next, layerAtActiveNode(next));
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toBe(untouched);
  });

  test("does not mutate the input points", () => {
    const document = documentWithStrokes(
      createStroke([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    );
    eraseSoft(document, { x: 0, y: 0 }, 10, 1);
    expect(document.drawings[0].drawing?.strokes[0].points[0].opacity).toBe(1);
  });
});

describe("eraseHard (HARD)", () => {
  test("cuts a circle out of the middle of a stroke into two fresh strokes", () => {
    const original = createStroke([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    const document = documentWithStrokes(original);

    const next = eraseHard(document, { x: 10, y: 0 }, 3);
    const strokes = strokesOfLayer(next, layerAtActiveNode(next));

    expect(strokes).toHaveLength(2);
    expect(strokes[0].id).not.toBe(original.id);
    expect(strokes[1].id).not.toBe(original.id);
    expect(strokes[0].id).not.toBe(strokes[1].id);
    for (const stroke of strokes) expect(stroke.points.length).toBeGreaterThanOrEqual(2);

    // Left run: 0 -> 7, right run: 13 -> 20 (cut points inserted at the circle).
    expect(strokes[0].points.map((point) => point.x)).toEqual([0, 7]);
    expect(strokes[1].points.map((point) => point.x)).toEqual([13, 20]);
  });

  test("keeps a single run when the circle only bites off one endpoint", () => {
    const document = documentWithStrokes(
      createStroke([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    );

    const next = eraseHard(document, { x: 0, y: 0 }, 5);
    const strokes = strokesOfLayer(next, layerAtActiveNode(next));
    expect(strokes).toHaveLength(1);
    expect(strokes[0].points.map((point) => point.x)).toEqual([5, 10, 20]);
  });

  test("removes a stroke fully covered by the circle", () => {
    const document = documentWithStrokes(
      createStroke([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    );
    expect(
      strokesOfLayer(eraseHard(document, { x: 0, y: 0 }, 10), layerAtActiveNode(document)),
    ).toHaveLength(0);
  });

  test("shares a stroke the circle never reaches by reference", () => {
    const untouched = createStroke([
      { x: 50, y: 50 },
      { x: 60, y: 50 },
    ]);
    const document = documentWithStrokes(untouched);
    const next = eraseHard(document, { x: 0, y: 0 }, 5);
    expect(next).toBe(document);
    expect(strokesOfLayer(next, layerAtActiveNode(next))[0]).toBe(untouched);
  });

  test("handles a polyline that enters and leaves the circle repeatedly", () => {
    // A path that passes near the origin twice, so the circle cuts it into
    // three outside runs (left, the middle detour, and the right tail).
    const document = documentWithStrokes(
      createStroke([
        { x: -10, y: 0 },
        { x: -2, y: 0 },
        { x: -2, y: -10 },
        { x: 2, y: -10 },
        { x: 2, y: 0 },
        { x: 10, y: 0 },
      ]),
    );

    const next = eraseHard(document, { x: 0, y: 0 }, 3);
    const strokes = strokesOfLayer(next, layerAtActiveNode(next));
    expect(strokes).toHaveLength(3);
    for (const stroke of strokes) expect(stroke.points.length).toBeGreaterThanOrEqual(2);
  });

  test("removes a single-point stroke inside the circle but keeps it outside", () => {
    const inside = documentWithStrokes(createStroke([{ x: 1, y: 0 }]));
    expect(
      strokesOfLayer(eraseHard(inside, { x: 0, y: 0 }, 3), layerAtActiveNode(inside)),
    ).toHaveLength(0);

    const outside = documentWithStrokes(createStroke([{ x: 10, y: 0 }]));
    const next = eraseHard(outside, { x: 0, y: 0 }, 3);
    expect(strokesOfLayer(next, layerAtActiveNode(next))).toHaveLength(1);
  });

  test("treats a non-positive radius as an empty brush", () => {
    const document = documentWithStrokes(
      createStroke([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    );
    expect(eraseHard(document, { x: 5, y: 0 }, 0)).toBe(document);
  });

  test("does not mutate the input stroke", () => {
    const original = createStroke([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    const document = documentWithStrokes(original);
    eraseHard(document, { x: 10, y: 0 }, 3);
    expect(original.points).toHaveLength(2);
    expect(document.drawings[0].drawing?.strokes[0].points).toHaveLength(2);
  });
});

describe("erase immutability", () => {
  test("no erase function mutates the input document", () => {
    const document = documentWithStrokes(
      createStroke([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ]),
      createStroke([
        { x: 0, y: 10 },
        { x: 20, y: 10 },
      ]),
    );
    const strokeCount = document.drawings[0].drawing?.strokes.length;
    const pointCounts = document.drawings[0].drawing?.strokes.map((s) => s.points.length);

    eraseStrokes(document, { x: 10, y: 0 }, 3);
    eraseSoft(document, { x: 10, y: 0 }, 3, 1);
    eraseHard(document, { x: 10, y: 0 }, 3);

    expect(document.drawings[0].drawing?.strokes.length).toBe(strokeCount);
    expect(document.drawings[0].drawing?.strokes.map((s) => s.points.length)).toEqual(pointCounts);
  });
});

describe("eraseHard boundary and shared drawings", () => {
  test("a tangent circle (d == radius) leaves the stroke by reference", () => {
    const stroke = createStroke([
      { x: 0, y: 5 },
      { x: 20, y: 5 },
    ]);
    const document = documentWithStrokes(stroke);
    // The circle touches the segment at exactly (10, 5): boundary = outside.
    expect(eraseHard(document, { x: 10, y: 0 }, 5)).toBe(document);
  });

  test("edits a drawing shared by several frames only once", () => {
    const document = drawableDocument();
    const layer = layerAtActiveNode(document);
    const stroke = createStroke([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    const shared = Object.assign(new GpenT(), document, {
      drawings: [
        Object.assign(new DrawingSlotT(), {
          drawing: Object.assign(new DrawingT(), { strokes: [stroke] }),
        }),
      ],
      layers: [
        document.layers[0],
        Object.assign(new LayerT(), layer, {
          frames: [
            Object.assign(new FrameT(), { frameNumber: 0, drawingIndex: 0 }),
            Object.assign(new FrameT(), { frameNumber: 1, drawingIndex: 0 }),
          ],
        }),
      ],
    });

    const next = eraseStrokes(shared, { x: 10, y: 0 }, 3);
    // The shared drawing is empty once, not twice-erased.
    expect(next.drawings[0].drawing?.strokes).toHaveLength(0);
    // The frames still point at the same slot and the input is untouched.
    expect(shared.drawings[0].drawing?.strokes).toHaveLength(1);
    expect(strokesOfLayer(shared, layerAtActiveNode(shared))).toHaveLength(1);
  });
});
