import { describe, expect, test } from "bun:test";

import {
  consumeScrubSteps,
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

describe("consumeScrubSteps", () => {
  test("turns a pixel delta into whole steps and carries the remainder", () => {
    expect(consumeScrubSteps(7, 0)).toEqual({ steps: 1, consumed: 6 });
    expect(consumeScrubSteps(5, 0)).toEqual({ steps: 0, consumed: 0 });
    expect(consumeScrubSteps(25, 6)).toEqual({ steps: 3, consumed: 24 });
    expect(consumeScrubSteps(-13, 0)).toEqual({ steps: -2, consumed: -12 });
    // 余量留在 consumed 里：小幅回摆不会反向触发一步
    expect(consumeScrubSteps(4, 6)).toEqual({ steps: 0, consumed: 6 });
  });
});
