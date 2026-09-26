import { describe, expect, test } from "bun:test";

import { frameGridLeft, timelineTickFrames } from "../src/lib/components/areas/timelineTicks";

describe("timelineTickFrames", () => {
  test("labels every framesPerTick frame starting at 1", () => {
    expect(timelineTickFrames(8, 12)).toEqual([1, 13, 25, 37, 49, 61, 73, 85]);
  });

  test("respects a custom start frame", () => {
    expect(timelineTickFrames(3, 5, 2)).toEqual([2, 7, 12]);
  });

  test("an empty ruler has no ticks", () => {
    expect(timelineTickFrames(0, 12)).toEqual([]);
  });
});

describe("frameGridLeft", () => {
  test("converts a frame number to a column offset in the frame width variable", () => {
    expect(frameGridLeft(25, 1)).toBe("calc(24 * var(--frame-width))");
  });

  test("the first frame sits at the grid origin", () => {
    expect(frameGridLeft(1, 1)).toBe("calc(0 * var(--frame-width))");
  });

  test("accepts an explicit column width", () => {
    expect(frameGridLeft(121, 1, "3.5ch")).toBe("calc(120 * 3.5ch)");
  });
});
