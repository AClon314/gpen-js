import { describe, expect, test } from "bun:test";

import {
  offsetPosition,
  pageOffset,
  viewportOffset,
  viewportRect,
  viewportSize,
} from "../src/lib/visualViewport.ts";

/** 只实现这个模块读的那几个字段，避免为了单测去造一个完整 DOM。 */
function fakeViewport(values: Partial<VisualViewport>): VisualViewport {
  return values as VisualViewport;
}

describe("viewportSize", () => {
  test("uses the visual viewport so pinch zoom and soft keyboards are reflected", () => {
    expect(viewportSize(fakeViewport({ width: 206, height: 457 }))).toEqual({
      width: 206,
      height: 457,
    });
  });

  test("falls back to something finite when there is no visual viewport", () => {
    const size = viewportSize(null);
    expect(Number.isFinite(size.width)).toBe(true);
    expect(Number.isFinite(size.height)).toBe(true);
  });
});

describe("viewportOffset / pageOffset", () => {
  test("no zoom means no offset in either reference frame", () => {
    const viewport = fakeViewport({ offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0 });
    expect(viewportOffset(viewport)).toEqual({ x: 0, y: 0 });
    expect(pageOffset(viewport)).toEqual({ x: 0, y: 0 });
  });

  test("pinch pan shows up as a layout-viewport offset", () => {
    expect(viewportOffset(fakeViewport({ offsetLeft: 60, offsetTop: 90 }))).toEqual({
      x: 60,
      y: 90,
    });
  });

  test("the page frame also includes document scroll", () => {
    expect(pageOffset(fakeViewport({ pageLeft: 1_060, pageTop: 11_790 }))).toEqual({
      x: 1_060,
      y: 11_790,
    });
  });
});

describe("viewportRect", () => {
  test("combines the page offset with the visible size", () => {
    const rect = viewportRect(
      fakeViewport({ pageTop: 100, pageLeft: 200, width: 390, height: 780 }),
    );
    expect(rect).toEqual({ top: 100, left: 200, width: 390, height: 780 });
  });
});

describe("offsetPosition", () => {
  test("translates a visual-viewport position into another reference frame", () => {
    expect(offsetPosition({ x: 10, y: 20 }, { x: 60, y: 90 })).toEqual({ x: 70, y: 110 });
    expect(offsetPosition({ x: 10, y: 20 }, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
  });
});
