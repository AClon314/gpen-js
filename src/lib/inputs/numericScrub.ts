/**
 * Pointer-scrub math shared by `InputSlider` and the CodeMirror scrubber
 * (`#lib/inputs/codemirror/numberScrubber`), so both turn a pixel delta into a
 * value the same way.
 */
import { clampTo, roundTo, withinBounds } from "./numericCaret.js";

/** Horizontal pixels that move the value by one precision unit. */
export const SCRUB_PIXELS_PER_STEP = 6;

/**
 * Precision derived from the user's text: `10` → `1`, `9.98` → `0.01`,
 * `9.987` → `0.001`.
 */
export function scrubQuantum(decimals: number): number {
  return decimals > 0 ? 10 ** -decimals : 1;
}

/** Value change per pixel of drag for a given precision. */
export function scrubSensitivity(decimals: number): number {
  return scrubQuantum(decimals) / SCRUB_PIXELS_PER_STEP;
}

/**
 * Value after dragging `pixels` from `start`: round to `decimals`, then apply
 * the soft bounds (only clamp when `origin` is already inside them).
 */
export function scrubValue(
  start: number,
  pixels: number,
  decimals: number,
  origin: number,
  lower?: number,
  upper?: number,
): number {
  const next = roundTo(start + pixels * scrubSensitivity(decimals), decimals);
  return withinBounds(origin, lower, upper) ? clampTo(next, lower, upper) : next;
}
