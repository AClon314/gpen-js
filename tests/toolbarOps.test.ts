import { describe, expect, test } from "bun:test";
import { EraserMode, GpenT } from "gpen-protocol/flatbuffers";

import { createDefaultGpen } from "../src/lib/protocol/defaults";
import { decodeGpen, encodeGpen } from "../src/lib/protocol/codec";
import {
  brushRadiusOf,
  color4ToCss,
  color4ToHex,
  DEFAULT_BRUSH_COLOR,
  DEFAULT_BRUSH_SIZE,
  DEFAULT_ERASER_SIZE,
  defaultToolbarState,
  ensureToolbarState,
  eraserRadiusOf,
  hexToColor4,
  normalizeColor,
  readToolbarState,
  toolIdName,
  writeBrushSettings,
  writeEraserSettings,
  writeToolbarState,
} from "../src/lib/components/toolbarOps";

function document(): GpenT {
  return createDefaultGpen("https://example.com/");
}

describe("defaultToolbarState", () => {
  test("fills the protocol shape with the documented defaults", () => {
    const state = defaultToolbarState();
    expect(state.activeToolId).toBe("builtin.brush");
    expect(state.brush?.size).toBe(DEFAULT_BRUSH_SIZE);
    expect(state.brush?.strength).toBeGreaterThan(0);
    expect(state.brush?.pressureMapping?.radius).toEqual([]);
    expect(state.brush?.pressureMapping?.opacity).toEqual([]);
    expect(state.eraser?.size).toBe(DEFAULT_ERASER_SIZE);
    expect(state.eraser?.mode).toBe(EraserMode.ERASER_MODE_HARD);
    expect(state.eraser?.flags?.activeLayerOnly).toBe(true);
    // Lasso stays disabled this round.
    expect(state.lasso?.enabled).toBe(false);
  });

  test("writes `target` as a derived value but never branches on it", () => {
    const state = defaultToolbarState();
    // ERASER_TARGET_POINT == 1, derived from mode = HARD.
    expect(state.eraser?.target).toBe(1);
    const strokeMode = writeEraserSettings(document(), {
      mode: EraserMode.ERASER_MODE_STROKE,
    });
    // Only `mode` is authoritative: `target` is left alone, and no code path
    // reads it (the erase functions take `mode`).
    expect(readToolbarState(strokeMode)?.eraser?.mode).toBe(EraserMode.ERASER_MODE_STROKE);
  });

  test("maps tool ids to protocol idnames", () => {
    expect(toolIdName("brush")).toBe("builtin.brush");
    expect(toolIdName("eraser")).toBe("builtin.eraser");
  });
});

describe("read/write toolbar state", () => {
  test("read returns undefined for a document without a toolbar state", () => {
    expect(readToolbarState(document())).toBeUndefined();
  });

  test("ensure creates the default without mutating the document", () => {
    const original = document();
    const state = ensureToolbarState(original);
    expect(state.brush?.size).toBe(DEFAULT_BRUSH_SIZE);
    expect(original.toolbarState).toBeNull();
  });

  test("write is immutable and shares the untouched fields by reference", () => {
    const original = document();
    const state = defaultToolbarState();
    const next = writeToolbarState(original, state);
    expect(next).not.toBe(original);
    expect(original.toolbarState).toBeNull();
    expect(readToolbarState(next)).toBe(state);
    // Everything else is shared, not copied.
    expect(next.nodes).toBe(original.nodes);
    expect(next.layers).toBe(original.layers);
  });

  test("patching the brush keeps the eraser and the rest of the state", () => {
    const first = writeBrushSettings(document(), { size: 40, spacing: 0.5 });
    const second = writeBrushSettings(first, { strength: 0.9 });

    const state = readToolbarState(second);
    expect(state?.brush?.size).toBe(40);
    expect(state?.brush?.spacing).toBe(0.5);
    expect(state?.brush?.strength).toBe(0.9);
    // The eraser patch-free path survives both brush writes.
    expect(state?.eraser?.mode).toBe(EraserMode.ERASER_MODE_HARD);
    expect(state?.activeToolId).toBe("builtin.brush");
  });

  test("patching the eraser keeps the brush settings", () => {
    const next = writeEraserSettings(document(), { size: 12, strength: 0.5 });
    const state = readToolbarState(next);
    expect(state?.eraser?.size).toBe(12);
    expect(state?.eraser?.strength).toBe(0.5);
    expect(state?.brush?.size).toBe(DEFAULT_BRUSH_SIZE);
  });

  test("a patch overwrites nested protocol structs, not the whole settings object", () => {
    const mapping = { radius: [1], opacity: [2] };
    const next = writeBrushSettings(document(), { pressureMapping: mapping as never });
    const brush = readToolbarState(next)?.brush;
    expect(brush?.pressureMapping?.radius).toEqual([1]);
    expect(brush?.pressureMapping?.opacity).toEqual([2]);
    // 没在 patch 里的字段仍然来自默认值。
    expect(brush?.size).toBe(DEFAULT_BRUSH_SIZE);
    expect(brush?.spacing).toBeGreaterThan(0);
  });

  test("repeated patches accumulate and never mutate the previous document", () => {
    const first = writeBrushSettings(document(), { size: 40 });
    const second = writeBrushSettings(first, { spacing: 0.75 });
    expect(readToolbarState(first)?.brush?.spacing).not.toBe(0.75);
    const brush = readToolbarState(second)?.brush;
    expect(brush?.size).toBe(40);
    expect(brush?.spacing).toBe(0.75);
  });

  test("patch writes into a document that had no toolbar state yet", () => {
    const next = writeBrushSettings(document(), { size: 8 });
    expect(readToolbarState(next)?.brush?.size).toBe(8);
    expect(readToolbarState(next)?.eraser?.mode).toBe(EraserMode.ERASER_MODE_HARD);
  });

  test("survives a FlatBuffer round trip (the state travels with the document)", () => {
    const next = writeBrushSettings(document(), { size: 33, strength: 0.75 });
    const decoded = decodeGpen(encodeGpen(next));
    const state = readToolbarState(decoded);
    expect(state?.brush?.size).toBe(33);
    expect(state?.brush?.strength).toBeCloseTo(0.75, 5);
    expect(state?.eraser?.mode).toBe(EraserMode.ERASER_MODE_HARD);
    expect(state?.activeToolId).toBe("builtin.brush");
  });
});

describe("size and radius", () => {
  test("BrushSettings.size is a diameter, Point.radius is a radius", () => {
    expect(brushRadiusOf({ size: 10 } as never)).toBe(5);
    expect(eraserRadiusOf({ size: 20 } as never)).toBe(10);
  });

  test("non-positive or non-finite sizes fall back instead of producing NaN", () => {
    expect(brushRadiusOf(undefined)).toBe(DEFAULT_BRUSH_SIZE / 2);
    expect(brushRadiusOf({ size: 0 } as never)).toBe(DEFAULT_BRUSH_SIZE / 2);
    expect(brushRadiusOf({ size: -4 } as never)).toBe(DEFAULT_BRUSH_SIZE / 2);
    expect(brushRadiusOf({ size: Number.NaN } as never)).toBe(DEFAULT_BRUSH_SIZE / 2);
    expect(eraserRadiusOf({ size: Number.POSITIVE_INFINITY } as never)).toBe(
      DEFAULT_ERASER_SIZE / 2,
    );
  });
});

describe("color conversion", () => {
  test("Color4 (0..1) converts to #rrggbb", () => {
    expect(color4ToHex({ r: 1, g: 0, b: 0 })).toBe("#ff0000");
    expect(color4ToHex(DEFAULT_BRUSH_COLOR)).toBe("#4f46e5");
    expect(color4ToHex(undefined)).toBe("#4f46e5");
  });

  test("clamps out-of-range channels", () => {
    expect(color4ToHex({ r: 2, g: -1, b: 0.5 })).toBe("#ff0080");
    expect(normalizeColor({ r: Number.NaN, g: 0.5, b: 1 })).toEqual({ r: 0, g: 0.5, b: 1 });
  });

  test("hex and rgb() parse back into 0..1 components", () => {
    const color = hexToColor4("#4f46e5");
    expect(color?.r).toBeCloseTo(0x4f / 255, 6);
    expect(color?.g).toBeCloseTo(0x46 / 255, 6);
    expect(color?.b).toBeCloseTo(0xe5 / 255, 6);
    expect(hexToColor4("#f00")).toEqual({ r: 1, g: 0, b: 0 });
    expect(hexToColor4("rgb(255, 0, 0)")).toEqual({ r: 1, g: 0, b: 0 });
    expect(hexToColor4("rgba(0, 128, 255, 0.5)")?.g).toBeCloseTo(128 / 255, 6);
  });

  test("rejects anything that is not a color", () => {
    expect(hexToColor4("rebeccapurple")).toBeUndefined();
    expect(hexToColor4("#12345")).toBeUndefined();
    expect(hexToColor4(undefined)).toBeUndefined();
    expect(hexToColor4(42)).toBeUndefined();
  });

  test("hex parsing is case- and whitespace-insensitive (table-driven)", () => {
    const cases: readonly [input: string, expected: { r: number; g: number; b: number }][] = [
      ["#4F46E5", { r: 0x4f / 255, g: 0x46 / 255, b: 0xe5 / 255 }],
      ["  #4f46e5  ", { r: 0x4f / 255, g: 0x46 / 255, b: 0xe5 / 255 }],
      ["#ABC", { r: 0xaa / 255, g: 0xbb / 255, b: 0xcc / 255 }],
      ["rgb(4, 70, 229)", { r: 4 / 255, g: 70 / 255, b: 229 / 255 }],
      ["rgb(4 70 229)", { r: 4 / 255, g: 70 / 255, b: 229 / 255 }],
      // alpha 通道被忽略（协议那里是独立的 Color4.a）。
      ["rgba(4, 70, 229, 0.25)", { r: 4 / 255, g: 70 / 255, b: 229 / 255 }],
    ];
    for (const [input, expected] of cases) {
      const parsed = hexToColor4(input);
      expect(parsed, input).toBeDefined();
      expect(parsed?.r, `${input} r`).toBeCloseTo(expected.r, 6);
      expect(parsed?.g, `${input} g`).toBeCloseTo(expected.g, 6);
      expect(parsed?.b, `${input} b`).toBeCloseTo(expected.b, 6);
    }
  });

  test("css output clamps before rounding to bytes", () => {
    expect(color4ToCss({ r: 2, g: -1, b: 0.5 })).toBe("rgb(255 0 128)");
    expect(color4ToCss({ r: Number.NaN, g: Number.POSITIVE_INFINITY, b: 0.5 })).toBe(
      "rgb(0 0 128)",
    );
  });

  test("round-trips hex -> Color4 -> hex", () => {
    for (const hex of ["#000000", "#ffffff", "#4f46e5", "#123456"]) {
      expect(color4ToHex(hexToColor4(hex))).toBe(hex);
    }
  });

  test("Color4 converts to a canvas-ready CSS color", () => {
    expect(color4ToCss({ r: 1, g: 0, b: 0 })).toBe("rgb(255 0 0)");
    expect(color4ToCss(undefined)).toBe("rgb(79 70 229)");
  });
});
