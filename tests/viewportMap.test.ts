import { describe, expect, test } from "bun:test";

import {
  MINIMAP_SPAN_FACTOR,
  clampViewportOrigin,
  projectMinimap,
  viewportOriginAtPoint,
} from "../src/lib/viewportMap.ts";

const extent = { width: 10_000, height: 20_000 };
const viewport = { x: 4_000, y: 9_000, width: 1_000, height: 800 };

describe("projectMinimap", () => {
  test("span is the viewport size times the factor", () => {
    const { span } = projectMinimap({ extent, viewport });
    expect(span.width).toBe(viewport.width * MINIMAP_SPAN_FACTOR);
    expect(span.height).toBe(viewport.height * MINIMAP_SPAN_FACTOR);
  });

  test("span never exceeds the document", () => {
    const small = { width: 300, height: 200 };
    const { span } = projectMinimap({
      extent: small,
      viewport: { x: 0, y: 0, width: 1_000, height: 800 },
    });
    expect(span.width).toBe(300);
    expect(span.height).toBe(200);
  });

  test("the origin is anchored to a span grid instead of following the view", () => {
    const { origin, span } = projectMinimap({ extent, viewport });
    // 视图中心 (4500, 9400) → 对齐到 span 网格 (4000, 6400)。
    expect(span).toEqual({ width: 4_000, height: 3_200 });
    expect(origin).toEqual({ x: 4_000, y: 6_400 });
  });

  test("the frame sits proportionally inside that grid cell", () => {
    const { rect } = projectMinimap({ extent, viewport });
    expect(rect.x).toBeCloseTo(0, 6);
    expect(rect.y).toBeCloseTo((9_000 - 6_400) / 3_200, 6);
    expect(rect.width).toBeCloseTo(1 / MINIMAP_SPAN_FACTOR, 6);
    expect(rect.height).toBeCloseTo(1 / MINIMAP_SPAN_FACTOR, 6);
  });

  test("panning inside one cell moves the frame without re-anchoring", () => {
    const base = projectMinimap({ extent, viewport });
    const moved = projectMinimap({ extent, viewport: { ...viewport, x: viewport.x + 400 } });
    expect(moved.origin).toEqual(base.origin);
    expect(moved.rect.x - base.rect.x).toBeCloseTo(400 / base.span.width, 6);
  });

  test("near the document edge the map stays inside it and the frame moves", () => {
    const { origin, rect } = projectMinimap({
      extent,
      viewport: { ...viewport, x: 0, y: 0 },
    });
    // 覆盖范围贴住文档左上角，视图框也跟着贴住地图的左上角。
    expect(origin.x).toBe(0);
    expect(origin.y).toBe(0);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });

  test("the frame never leaves the map at the far edge either", () => {
    const { rect } = projectMinimap({
      extent,
      viewport: { x: 9_000, y: 19_200, width: 1_000, height: 800 },
    });
    expect(rect.x).toBeCloseTo(0.75, 6);
    expect(rect.y).toBeCloseTo(0.75, 6);
  });

  test("degenerate input does not produce NaN", () => {
    const { rect, span } = projectMinimap({
      extent: { width: 0, height: 0 },
      viewport: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(span).toEqual({ width: 0, height: 0 });
    expect(Number.isFinite(rect.x)).toBe(true);
    expect(Number.isFinite(rect.width)).toBe(true);
  });
});

describe("viewportOriginAtPoint", () => {
  test("after navigating, the frame lands under the pointer", () => {
    const next = viewportOriginAtPoint({ extent, viewport, nx: 0.6, ny: 0.7 });
    const projected = projectMinimap({ extent, viewport: { ...viewport, ...next } });
    expect(projected.rect.x + projected.rect.width / 2).toBeCloseTo(0.6, 6);
    expect(projected.rect.y + projected.rect.height / 2).toBeCloseTo(0.7, 6);
  });

  test("the document point under the pointer becomes the viewport centre", () => {
    const { origin, span } = projectMinimap({ extent, viewport });
    const next = viewportOriginAtPoint({ extent, viewport, nx: 0.8, ny: 0.7 });
    expect(next.x + viewport.width / 2).toBeCloseTo(origin.x + 0.8 * span.width, 6);
    expect(next.y + viewport.height / 2).toBeCloseTo(origin.y + 0.7 * span.height, 6);
  });

  test("the result is clamped into the document", () => {
    const edge = { ...viewport, x: 8_000, y: 9_000 };
    const next = viewportOriginAtPoint({ extent, viewport: edge, nx: 1, ny: 1 });
    expect(next.x).toBe(extent.width - edge.width);
    expect(next.y).toBeLessThan(extent.height - edge.height);
  });

  test("out-of-range points are clamped instead of extrapolated", () => {
    const { origin, span } = projectMinimap({ extent, viewport });
    const next = viewportOriginAtPoint({ extent, viewport, nx: -3, ny: 42 });
    expect(next.x + viewport.width / 2).toBeCloseTo(origin.x, 6);
    expect(next.y + viewport.height / 2).toBeCloseTo(origin.y + span.height, 6);
  });
});

describe("clampViewportOrigin", () => {
  test("keeps a viewport inside the document", () => {
    expect(clampViewportOrigin({ x: -50, y: 99_999 }, { extent, viewport })).toEqual({
      x: 0,
      y: extent.height - viewport.height,
    });
  });

  test("a document smaller than the viewport parks it at the origin", () => {
    expect(
      clampViewportOrigin(
        { x: 120, y: 80 },
        { extent: { width: 300, height: 200 }, viewport: { x: 0, y: 0, width: 600, height: 400 } },
      ),
    ).toEqual({ x: 0, y: 0 });
  });
});
