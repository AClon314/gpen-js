import { describe, expect, test } from "bun:test";

import {
  createLayerView,
  mapLayerPoint,
  pivotAtViewportCenter,
  unmapClientPoint,
} from "../src/lib/layers/layerView";

/** Test mapping: element origin at document (100, 200), pivot at (50, 60). */
const baseMapping = {
  pivot: { x: 50, y: 60 },
  rotation: 0,
  origin: { x: 100, y: 200 },
  scroll: { x: 0, y: 0 },
};

function close(received: { x: number; y: number }, expected: { x: number; y: number }) {
  // 90°/180° rotations produce values like 6.1e-17 instead of exact 0/1.
  expect(received.x).toBeCloseTo(expected.x, 9);
  expect(received.y).toBeCloseTo(expected.y, 9);
}

describe("layer view pivot", () => {
  test("maps the viewport center into layer-local coordinates", () => {
    expect(
      pivotAtViewportCenter({ left: 0, top: 100 }, { x: 0, y: 0 }, { width: 800, height: 600 }),
    ).toEqual({ x: 400, y: 200 });
  });

  test("accounts for a panned (pinched) visual viewport", () => {
    expect(
      pivotAtViewportCenter({ left: 60, top: 90 }, { x: 60, y: 90 }, { width: 206, height: 457 }),
    ).toEqual({ x: 103, y: 228.5 });
  });

  test("handles a layer that starts above the viewport", () => {
    expect(
      pivotAtViewportCenter({ left: -20, top: -900 }, { x: 0, y: 0 }, { width: 400, height: 300 }),
    ).toEqual({ x: 220, y: 1050 });
  });
});

describe("layer view canvas target", () => {
  test("keeps rotation without touching the DOM", () => {
    const view = createLayerView({ kind: "canvas" });
    expect(view.element).toBeNull();
    expect(view.rotation()).toBe(0);

    expect(view.setRotation(20)).toBe(true);
    expect(view.rotation()).toBe(20);

    view.restore();
    expect(view.rotation()).toBe(0);
  });

  test("falls back to a document-origin mapping (identity at rotation 0)", () => {
    const view = createLayerView({ kind: "canvas" });
    const local = { x: 12, y: -7 };
    // No window in bun test, so scroll is (0, 0): layer-local == client.
    close(view.toClientPoint(local), local);
    close(view.toLayerPoint(local), local);
  });
});

describe("layer point mapping", () => {
  test("rotation 0 is a pure origin translation", () => {
    close(mapLayerPoint({ x: 5, y: 7 }, baseMapping), { x: 105, y: 207 });
    close(unmapClientPoint({ x: 105, y: 207 }, baseMapping), { x: 5, y: 7 });
  });

  test("translation by scroll moves the mapping by the scroll delta", () => {
    const scrolled = { ...baseMapping, scroll: { x: 30, y: 40 } };
    close(mapLayerPoint({ x: 5, y: 7 }, scrolled), { x: 75, y: 167 });
    close(unmapClientPoint({ x: 75, y: 167 }, scrolled), { x: 5, y: 7 });
  });

  test("90 degrees rotates clockwise around the pivot (y-down)", () => {
    const mapping = { ...baseMapping, rotation: 90 };
    // pivot is fixed under rotation: map(pivot) == pivot in client coords
    // (origin + pivot, since scroll is 0).
    close(mapLayerPoint({ x: 50, y: 60 }, mapping), { x: 150, y: 260 });
    // A point 10 to the right of the pivot ends up 10 *below* it (clockwise).
    close(mapLayerPoint({ x: 60, y: 60 }, mapping), { x: 150, y: 270 });
    close(unmapClientPoint({ x: 150, y: 270 }, mapping), { x: 60, y: 60 });
  });

  test("180 degrees is point reflection around the pivot", () => {
    const mapping = { ...baseMapping, rotation: 180 };
    close(mapLayerPoint({ x: 60, y: 70 }, mapping), { x: 140, y: 250 });
    close(unmapClientPoint({ x: 140, y: 250 }, mapping), { x: 60, y: 70 });
  });

  test("map and unmap are inverses for a rotated, scrolled mapping", () => {
    const mapping = {
      pivot: { x: 123.5, y: -40.25 },
      rotation: 37.5,
      origin: { x: -300, y: 900 },
      scroll: { x: 120, y: 55 },
    };
    for (const point of [
      { x: 0, y: 0 },
      { x: 400, y: 250 },
      { x: -12.5, y: 33.75 },
    ]) {
      close(unmapClientPoint(mapLayerPoint(point, mapping), mapping), point);
    }
  });
});
