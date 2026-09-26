/**
 * Facade over the caret-relative numeric stepper, independent of DOM/Svelte.
 *
 * The behavior is documented in `src/lib/components/widgets/inputs/README.md`; the implementation is split
 * by concern:
 *
 * - `caretDigits.ts` — parse `text` + caret and resolve which decimal place to
 *   step (`planCaretStep` / `CaretPlan`);
 * - `caretStep.ts` — apply a place plan and the value-level `stepBy*` rules;
 * - `caretSign.ts` — sign toggling and the soft / hard bounds helpers;
 * - `caretFormat.ts` — decimal-place counting and fixed-width formatting.
 *
 * `stepAtCaret` stays here as the entry point: parse the caret position, then
 * return the edit instruction (new text + caret).
 */
import { clampCaret, parseNumericText, planCaretStep } from "./caretDigits.js";
import { applyCaretStep, type StepResult } from "./caretStep.js";
import { toggleSign } from "./caretSign.js";

export {
  /** Number of fractional digits needed to write `text` (exponent-aware). */
  decimalPlacesInText,
  /** Number of fractional digits needed to write `value` (exponent-aware). */
  decimalPlaces,
  /** Round to `decimals` fractional digits (no-op when `undefined`); kills `-0`. */
  roundTo,
} from "./caretFormat.js";

export {
  /** Clamp to the finite bounds (`undefined` bound = unbounded); kills `-0`. */
  clampTo,
  /** True when `value` is inside the (soft) bounds. */
  withinBounds,
  /** The value as a finite number, or `undefined` when it is not one. */
  finiteNumber,
  /** Soft bounds: clamp only when `origin` is already inside them. */
  softClampTo,
  /** Clamp, round, clamp again (so rounding cannot push the value out of bounds). */
  clampAndRound,
  /** Clamp to `min`/`max`, round to the `step`'s decimal width (opt-in). */
  validateNumeric,
  /** Toggle the sign in front of the number (case 5 and the `-` / `+` keys). */
  toggleSign,
} from "./caretSign.js";

export type {
  /** The `min` / `max` / `step` props, as a validation-only constraint set. */
  NumericValidation,
} from "./caretSign.js";

export {
  /** Step the value (not the magnitude) by a fixed amount; may cross zero. */
  addStepToValue,
  /** The `step` prop as a step amount (`undefined` = no quantum). */
  stepAmount,
  /** Parse an optional numeric HTML attribute (`min` / `max` / `step`). */
  numericAttribute,
  /** Rule for a position along the slider bar (`0` = minus, `1` = plus). */
  stepRuleAt,
  /** Place of the leading significant digit (`1.12` → 0, `0.12` → -1). */
  significantPlace,
  /** 智能整数位 step: `10 ** place` of the leading significant digit. */
  stepByDigit,
  /** 用户最大精度 step: the smallest place the user actually typed. */
  stepByPrecision,
  /** Dispatch on `StepRule`; the middle zone of the slider uses the `step`. */
  stepByRule,
} from "./caretStep.js";

export type {
  /** 一次按位权步进的结果：新文本与光标位置。 */
  StepResult,
  /** A step over the whole value (no caret involved). */
  ValueStep,
  /** Soft bounds for a value step (`origin` = the value before stepping). */
  StepBounds,
  /** How the slider picks a step amount: `digit` / `step` / `precision`. */
  StepRule,
  /** Options for `stepByRule` (the slider's three zones). */
  StepRuleOptions,
} from "./caretStep.js";

/**
 * Step caret-relative (cases 1–5 of `InputNumber.md`). `direction` is `1` for
 * ↑ / wheel-up and `-1` for ↓ / wheel-down. A non-numeric text is returned
 * unchanged.
 */
export function stepAtCaret(text: string, caret: number, direction: -1 | 1): StepResult {
  const safeCaret = clampCaret(caret, text.length);
  const value = parseNumericText(text);
  if (value === undefined) return { text, caret: safeCaret };

  const plan = planCaretStep(text, safeCaret, direction, value);
  // case 5: caret left of the sign toggles it (keeping an explicit `+`).
  if (plan.kind === "toggle") return toggleSign(text, 0);
  // case 4 at a bare decimal point: append the zero the wheel starts from.
  if (plan.kind === "insert") return { text: plan.text, caret: plan.caret };
  return applyCaretStep(text, value, safeCaret, direction, plan);
}
