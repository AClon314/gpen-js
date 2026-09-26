/**
 * Sign toggling and bound helpers for the numeric widgets, DOM/Svelte-free.
 *
 * The bounds here are the shared "soft" semantics of `docs/input.md`: a step
 * clamps only when the origin is already inside the bounds, and `validateNumeric`
 * is the explicit, opt-in hard clamp used by the components' output channel.
 */
import { clampCaret } from "./caretDigits.js";
import { decimalPlaces, roundTo } from "./caretFormat.js";

/** The value as a finite number, or `undefined` when it is not one. */
export function finiteNumber(candidate: unknown): number | undefined {
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

/** Clamp to the finite bounds (`undefined` bound = unbounded); kills `-0`. */
export function clampTo(
  value: number,
  lower: number | undefined,
  upper: number | undefined,
): number {
  let next = value;
  if (lower !== undefined) next = Math.max(lower, next);
  if (upper !== undefined) next = Math.min(upper, next);
  return Object.is(next, -0) ? 0 : next;
}

/** True when `value` is inside the (soft) bounds. */
export function withinBounds(
  value: number,
  lower: number | undefined,
  upper: number | undefined,
): boolean {
  return (lower === undefined || value >= lower) && (upper === undefined || value <= upper);
}

/**
 * Soft bounds: clamp only when `origin` is already inside them. Typing `150`
 * into a `0–100` field then keeps ↑/↓ free until the value comes back in.
 */
export function softClampTo(
  value: number,
  origin: number,
  lower: number | undefined,
  upper: number | undefined,
): number {
  return withinBounds(origin, lower, upper) ? clampTo(value, lower, upper) : value;
}

/** Clamp, round, clamp again (so rounding cannot push the value out of bounds). */
export function clampAndRound(
  value: number,
  lower: number | undefined,
  upper: number | undefined,
  decimals: number | undefined,
): number {
  return clampTo(roundTo(clampTo(value, lower, upper), decimals), lower, upper);
}

/** The `min` / `max` / `step` props, as a validation-only constraint set. */
export interface NumericValidation {
  min?: number;
  max?: number;
  step?: number;
}

/**
 * The limited value for a validation step: clamp to `min`/`max`, round to the
 * `step`'s decimal width. Validation is **opt-in** — the components keep the
 * value the caller typed; call this when the limited value is actually wanted.
 */
export function validateNumeric(value: number, options: NumericValidation = {}): number {
  const decimals = options.step === undefined ? undefined : decimalPlaces(options.step);
  return clampAndRound(value, options.min, options.max, decimals);
}

/** The current sign of a numeric text (`none` = unsigned). */
type Sign = "negative" | "positive" | "none";

/** Read the explicit sign of `text` (only `-` / `+` prefixes count). */
function readSign(text: string): Sign {
  if (text.startsWith("-")) return "negative";
  if (text.startsWith("+")) return "positive";
  return "none";
}

/** True when `target` is already satisfied, so toggling must be a no-op. */
function isNoopToggle(sign: Sign, target: "positive" | "negative" | undefined): boolean {
  if (target === "positive") return sign !== "negative";
  if (target === "negative") return sign === "negative";
  return false;
}

/**
 * Toggle the sign in front of the number (case 5 and the `-` / `+` keys). The
 * caret keeps its position relative to the digits, so it follows the added or
 * removed sign. `target` lets the `+` key force a positive number instead of
 * toggling. Non-numeric text is returned unchanged.
 */
export function toggleSign(
  text: string,
  caret: number,
  target?: "positive" | "negative",
): { text: string; caret: number } {
  const trimmed = text.trim();
  if (trimmed === "" || !Number.isFinite(Number(trimmed))) return { text, caret };
  const safeCaret = clampCaret(caret, text.length);
  const sign = readSign(text);
  if (isNoopToggle(sign, target)) return { text, caret: safeCaret };
  // Cycling keeps an explicit sign: `-5` ⇄ `+5`; an unsigned number gains `-`.
  if (sign === "negative") return { text: `+${text.slice(1)}`, caret: safeCaret };
  if (sign === "positive") return { text: `-${text.slice(1)}`, caret: safeCaret };
  return { text: `-${text}`, caret: safeCaret + 1 };
}
