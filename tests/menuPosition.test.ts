import { describe, expect, test } from "bun:test";

import {
  MENU_MARGIN_PX,
  anchoredMenuTop,
  clampMenuCoordinate,
  clampMenuPoint,
  submenuFlip,
} from "../src/lib/components/contextMenu/menuPosition";

const VIEWPORT = { width: 1000, height: 800 };

describe("clampMenuCoordinate", () => {
  test("leaves a coordinate already inside the viewport alone", () => {
    expect(clampMenuCoordinate(120, 200, 1000)).toBe(120);
  });

  test("pushes negative and NaN coordinates to the margin", () => {
    expect(clampMenuCoordinate(-40, 200, 1000)).toBe(MENU_MARGIN_PX);
    expect(clampMenuCoordinate(Number.NaN, 200, 1000)).toBe(MENU_MARGIN_PX);
  });

  test("pulls a coordinate back from the far edge", () => {
    // 1000 - 200 - 8 = 792
    expect(clampMenuCoordinate(999, 200, 1000)).toBe(792);
  });

  test("keeps the margin when the menu is larger than the viewport", () => {
    expect(clampMenuCoordinate(500, 2000, 1000)).toBe(MENU_MARGIN_PX);
  });

  test("treats a negative size as zero", () => {
    expect(clampMenuCoordinate(999, -10, 1000)).toBe(992);
  });

  test("only enforces the margin when the viewport is unknown", () => {
    expect(clampMenuCoordinate(400, 200, 0)).toBe(400);
    expect(clampMenuCoordinate(-5, 200, 0)).toBe(MENU_MARGIN_PX);
  });
});

describe("clampMenuPoint", () => {
  test("keeps each of the four corners inside the viewport", () => {
    const size = { width: 200, height: 100 };
    expect(clampMenuPoint({ x: 5, y: 5 }, size, VIEWPORT)).toEqual({ x: 8, y: 8 });
    expect(clampMenuPoint({ x: 995, y: 5 }, size, VIEWPORT)).toEqual({ x: 792, y: 8 });
    expect(clampMenuPoint({ x: 5, y: 795 }, size, VIEWPORT)).toEqual({ x: 8, y: 692 });
    expect(clampMenuPoint({ x: 995, y: 795 }, size, VIEWPORT)).toEqual({ x: 792, y: 692 });
  });

  test("pins to the top-left margin when the viewport is too small", () => {
    const size = { width: 400, height: 300 };
    expect(clampMenuPoint({ x: 10, y: 10 }, size, { width: 100, height: 80 })).toEqual({
      x: MENU_MARGIN_PX,
      y: MENU_MARGIN_PX,
    });
  });
});

describe("anchoredMenuTop", () => {
  test("sits below the anchor when there is room", () => {
    expect(anchoredMenuTop(100, 120, 200, 2, 800)).toBe(122);
  });

  test("flips above the anchor when the menu would overflow the bottom", () => {
    expect(anchoredMenuTop(700, 720, 200, 2, 800)).toBe(498);
  });

  test("never places the flipped menu above the top margin", () => {
    expect(anchoredMenuTop(10, 30, 200, 2, 100)).toBe(MENU_MARGIN_PX);
  });
});

describe("submenuFlip", () => {
  test("keeps a submenu that fits untouched", () => {
    const rect = { left: 100, top: 100, right: 400, bottom: 300 };
    expect(submenuFlip(rect, VIEWPORT)).toEqual({ horizontal: false, vertical: false });
  });

  test("flips horizontally past the right edge and vertically past the bottom", () => {
    const rect = { left: 900, top: 700, right: 1010, bottom: 810 };
    expect(submenuFlip(rect, VIEWPORT)).toEqual({ horizontal: true, vertical: true });
  });
});
