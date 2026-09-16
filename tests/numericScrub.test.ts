import { describe, expect, test } from "bun:test";

import {
  SCRUB_PIXELS_PER_STEP,
  scrubQuantum,
  scrubSensitivity,
  scrubValue,
} from "../src/lib/inputs/numericScrub.ts";

describe("scrub precision", () => {
  test("derives the quantum from the decimal width", () => {
    expect(scrubQuantum(0)).toBe(1);
    expect(scrubQuantum(2)).toBe(0.01);
    expect(scrubQuantum(3)).toBe(0.001);
    expect(scrubSensitivity(2)).toBe(0.01 / SCRUB_PIXELS_PER_STEP);
  });
});

describe("scrubValue", () => {
  test("turns pixels into a rounded value", () => {
    expect(scrubValue(9.98, SCRUB_PIXELS_PER_STEP, 2, 9.98)).toBe(9.99);
    expect(scrubValue(9.98, SCRUB_PIXELS_PER_STEP * 2, 2, 9.98)).toBe(10);
  });

  test("clamps only when the origin is inside the bounds", () => {
    expect(scrubValue(99, SCRUB_PIXELS_PER_STEP * 10, 0, 99, 0, 100)).toBe(100);
    // origin 已超界 → 不再钳制，步进可用
    expect(scrubValue(150, SCRUB_PIXELS_PER_STEP, 0, 150, 0, 100)).toBe(151);
    expect(scrubValue(150, -SCRUB_PIXELS_PER_STEP, 0, 150, 0, 100)).toBe(149);
  });
});
