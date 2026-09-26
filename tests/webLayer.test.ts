import { describe, expect, test } from "bun:test";

import { drawDot, drawPolyline } from "../src/lib/scenel/strokeCanvas.ts";
import {
  isHardExcluded,
  isTransparentWrapper,
  webLayerScore,
  type WebLayerMetrics,
} from "../src/lib/layers/web.ts";

function metrics(area: number, textLength: number): WebLayerMetrics {
  return { tag: "candidate", area, textLength };
}

describe("webLayerScore", () => {
  test("returns zero when both totals are zero", () => {
    expect(webLayerScore(metrics(100, 20), metrics(0, 0))).toBe(0);
  });

  test("gives a single candidate the full score", () => {
    expect(webLayerScore(metrics(100, 20), metrics(100, 20))).toBe(2);
  });

  test("keeps equally sized candidates tied", () => {
    expect(webLayerScore(metrics(50, 10), metrics(100, 20))).toBe(1);
  });

  test("allows the text share to dominate the score", () => {
    expect(webLayerScore(metrics(1, 90), metrics(100, 100))).toBeCloseTo(0.91);
  });
});

type FakeElementOptions = {
  tagName?: string;
  matches?: (selector: string) => boolean;
  attributes?: Record<string, string>;
  children?: unknown[];
  viewport?: { width: number; height: number };
};

/** 只实现排除规则读的那几个字段，避免为了单测去造一个完整 DOM。 */
function fakeElement(options: FakeElementOptions = {}): HTMLElement {
  const attributes = options.attributes ?? {};
  const viewport = options.viewport ?? { width: 1000, height: 800 };
  return {
    tagName: options.tagName ?? "DIV",
    children: options.children ?? [],
    matches: options.matches ?? (() => false),
    getAttribute: (name: string) => attributes[name] ?? null,
    ownerDocument: {
      defaultView: { innerWidth: viewport.width, innerHeight: viewport.height },
    },
  } as unknown as HTMLElement;
}

function fakeStyle(overrides: Record<string, string> = {}): CSSStyleDeclaration {
  return {
    display: "block",
    visibility: "visible",
    position: "static",
    ...overrides,
  } as unknown as CSSStyleDeclaration;
}

function fakeRect(width: number, height: number): DOMRect {
  return { width, height } as unknown as DOMRect;
}

describe("webLayer hard exclusion", () => {
  test("excludes gpen's own overlay nodes by selector", () => {
    const overlay = fakeElement({ matches: () => true });
    expect(isHardExcluded(overlay, fakeStyle(), fakeRect(100, 100))).toBe(true);
  });

  test("excludes metadata / non-visual tags regardless of spelling", () => {
    expect(
      isHardExcluded(fakeElement({ tagName: "SCRIPT" }), fakeStyle(), fakeRect(100, 100)),
    ).toBe(true);
    expect(
      isHardExcluded(fakeElement({ tagName: "template" }), fakeStyle(), fakeRect(100, 100)),
    ).toBe(true);
  });

  test("excludes hidden nodes", () => {
    expect(isHardExcluded(fakeElement(), fakeStyle({ display: "none" }), fakeRect(100, 100))).toBe(
      true,
    );
    expect(
      isHardExcluded(fakeElement(), fakeStyle({ visibility: "hidden" }), fakeRect(100, 100)),
    ).toBe(true);
  });

  test("excludes aria-hidden nodes, case-insensitively", () => {
    expect(
      isHardExcluded(
        fakeElement({ attributes: { "aria-hidden": "true" } }),
        fakeStyle(),
        fakeRect(1, 1),
      ),
    ).toBe(true);
    expect(
      isHardExcluded(
        fakeElement({ attributes: { "aria-hidden": "TRUE" } }),
        fakeStyle(),
        fakeRect(1, 1),
      ),
    ).toBe(true);
    expect(
      isHardExcluded(
        fakeElement({ attributes: { "aria-hidden": "false" } }),
        fakeStyle(),
        fakeRect(1, 1),
      ),
    ).toBe(false);
  });

  test("excludes a fixed layer that covers most of the viewport", () => {
    const style = fakeStyle({ position: "fixed" });
    // 900 / 1000 = 90% of the viewport width, i.e. the inclusive threshold.
    expect(isHardExcluded(fakeElement(), style, fakeRect(900, 50))).toBe(true);
    expect(isHardExcluded(fakeElement(), style, fakeRect(50, 720))).toBe(true);
    expect(isHardExcluded(fakeElement(), style, fakeRect(500, 400))).toBe(false);
  });

  test("keeps a large static element as a candidate (only fixed fills are excluded)", () => {
    expect(isHardExcluded(fakeElement(), fakeStyle(), fakeRect(1000, 800))).toBe(false);
  });
});

describe("webLayer transparent wrappers", () => {
  test("traverses display:contents wrappers", () => {
    expect(
      isTransparentWrapper(fakeElement(), fakeStyle({ display: "contents" }), fakeRect(100, 100)),
    ).toBe(true);
  });

  test("traverses zero-sized wrappers that have children", () => {
    expect(isTransparentWrapper(fakeElement({ children: [{}] }), fakeStyle(), fakeRect(0, 0))).toBe(
      true,
    );
    expect(isTransparentWrapper(fakeElement(), fakeStyle(), fakeRect(0, 0))).toBe(false);
  });

  test("keeps a sized element as a candidate", () => {
    expect(
      isTransparentWrapper(fakeElement({ children: [{}] }), fakeStyle(), fakeRect(10, 10)),
    ).toBe(false);
  });
});

type RecordingContext = {
  ctx: CanvasRenderingContext2D;
  calls: string[];
};

/** 记录绘制调用的 2D context 替身（绘制指令是纯函数，无需真画布）。 */
function recordingContext(): RecordingContext {
  const calls: string[] = [];
  const ctx = {
    beginPath: () => calls.push("beginPath"),
    arc: (x: number, y: number, radius: number) => calls.push(`arc(${x},${y},${radius})`),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    moveTo: (x: number, y: number) => calls.push(`moveTo(${x},${y})`),
    lineTo: (x: number, y: number) => calls.push(`lineTo(${x},${y})`),
    set fillStyle(value: string) {
      calls.push(`fillStyle=${value}`);
    },
    set strokeStyle(value: string) {
      calls.push(`strokeStyle=${value}`);
    },
    set lineWidth(value: number) {
      calls.push(`lineWidth=${value}`);
    },
    set lineCap(value: string) {
      calls.push(`lineCap=${value}`);
    },
    set lineJoin(value: string) {
      calls.push(`lineJoin=${value}`);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("stroke canvas drawing primitives", () => {
  test("drawDot fills a circle of radius / 2", () => {
    const { ctx, calls } = recordingContext();
    drawDot(ctx, { x: 10, y: 20 }, 8, "#abc");
    expect(calls).toEqual(["beginPath", "arc(10,20,4)", "fillStyle=#abc", "fill"]);
  });

  test("drawDot clamps a vanishing radius to half a pixel", () => {
    const { ctx, calls } = recordingContext();
    drawDot(ctx, { x: 0, y: 0 }, 0.2, "#000");
    expect(calls).toContain("arc(0,0,0.5)");
  });

  test("drawPolyline degrades a single-point list to a dot", () => {
    const { ctx, calls } = recordingContext();
    drawPolyline(ctx, [{ x: 1, y: 2 }], [8], "#f00");
    expect(calls).toEqual(["beginPath", "arc(1,2,4)", "fillStyle=#f00", "fill"]);
  });

  test("drawPolyline strokes each segment with the averaged radius", () => {
    const { ctx, calls } = recordingContext();
    drawPolyline(
      ctx,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [2, 4],
      "#0f0",
    );
    expect(calls).toEqual([
      "strokeStyle=#0f0",
      "lineCap=round",
      "lineJoin=round",
      "beginPath",
      "lineWidth=3",
      "moveTo(0,0)",
      "lineTo(10,0)",
      "stroke",
    ]);
  });

  test("drawPolyline draws nothing for an empty list", () => {
    const { ctx, calls } = recordingContext();
    drawPolyline(ctx, [], [], "#000");
    expect(calls).toEqual([]);
  });
});
