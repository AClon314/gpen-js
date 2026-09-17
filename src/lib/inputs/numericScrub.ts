/**
 * Pointer-scrub math for the CodeMirror `±` handle
 * (`#lib/inputs/codemirror/numberScrubber`): a pixel delta becomes a value
 * change at the precision of the number under the cursor.
 *
 * `InputSlider` no longer drags continuously — it steps discretely in one of
 * three zones (see `numericCaret.ts` / `docs/input.md`) — but keeps the same
 * `SCRUB_PIXELS_PER_STEP = 6` sensitivity.
 */
import { roundTo, softClampTo } from "./numericCaret.js";

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
  return softClampTo(next, origin, lower, upper);
}
