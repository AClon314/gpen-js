/**
 * Pointer-scrub math shared by the two drag gestures of the numeric widgets:
 * the CodeMirror `±` handle (`#lib/inputs/codemirror/numberScrubber`) drags
 * continuously at the precision of the number under the cursor, and
 * `InputSlider` steps discretely in one of three zones (see `numericCaret.ts` /
 * `docs/input.md`) — both at `SCRUB_PIXELS_PER_STEP` pixels per unit.
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
 * Whole steps to apply for a drag delta, plus the pixel position that has been
 * spent. The remainder carries over to the next move, so tiny back-and-forth
 * motions do not re-trigger a step (shared by the `InputSlider` zones and the
 * CodeMirror handle, which both step once per `SCRUB_PIXELS_PER_STEP`).
 */
export function consumeScrubSteps(
  accumulated: number,
  consumed: number,
  pixelsPerStep: number = SCRUB_PIXELS_PER_STEP,
): { steps: number; consumed: number } {
  const whole = Math.trunc((accumulated - consumed) / pixelsPerStep);
  const steps = Object.is(whole, -0) ? 0 : whole; // 与 clampTo / roundTo 一样不吐 -0
  return { steps, consumed: consumed + steps * pixelsPerStep };
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
