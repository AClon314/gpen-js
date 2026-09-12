import { describe, expect, test } from "bun:test";

import { webLayerScore, type WebLayerMetrics } from "../src/lib/canvas/webLayer.ts";

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
