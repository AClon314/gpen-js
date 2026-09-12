import { describe, expect, test } from "bun:test";

import {
  boundsFor,
  clampToBounds,
  reconcileBoundsPosition,
} from "../src/lib/gestures/draggable.ts";

const VIEWPORT = { width: 1000, height: 800 };

describe("draggable bounds", () => {
  test("keeps the element inside the viewport with a margin", () => {
    expect(boundsFor(52, VIEWPORT, 12)).toEqual({ minX: 12, minY: 12, maxX: 936, maxY: 736 });
  });

  test("never produces inverted bounds for oversized elements", () => {
    expect(boundsFor(1200, VIEWPORT, 12)).toEqual({ minX: 12, minY: 12, maxX: 12, maxY: 12 });
  });
});

describe("draggable clamp", () => {
  test("clamps both axes to the bounds", () => {
    const bounds = boundsFor(52, VIEWPORT, 12);
    expect(clampToBounds({ x: -100, y: 5000 }, bounds)).toEqual({ x: 12, y: 736 });
    expect(clampToBounds({ x: 500, y: 400 }, bounds)).toEqual({ x: 500, y: 400 });
  });
});

describe("draggable viewport reconcile", () => {
  const previous = boundsFor(52, VIEWPORT, 12);
  const bigger = boundsFor(52, { width: 1200, height: 900 }, 12);
  const smaller = boundsFor(52, { width: 800, height: 600 }, 12);

  test("keeps a right/bottom-edge position glued when the viewport grows", () => {
    expect(reconcileBoundsPosition({ x: 936, y: 736 }, previous, bigger)).toEqual({
      x: 1136,
      y: 836,
    });
  });

  test("clamps a mid-screen position back inside when the viewport shrinks", () => {
    expect(reconcileBoundsPosition({ x: 900, y: 700 }, previous, smaller)).toEqual({
      x: 736,
      y: 536,
    });
  });

  test("leaves absolute left/top positions untouched", () => {
    expect(reconcileBoundsPosition({ x: 500, y: 400 }, previous, bigger)).toEqual({
      x: 500,
      y: 400,
    });
    expect(reconcileBoundsPosition({ x: 12, y: 12 }, previous, bigger)).toEqual({ x: 12, y: 12 });
  });
});
