/**
 * Step computation for the numeric stepper, DOM/Svelte-free.
 *
 * Two layers share one core (`stepValue` / `addAtPrecision` / `formatValue`):
 * caret-relative `applyCaretStep` (cases 2–4 of `src/lib/components/widgets/inputs/README.md`) and the
 * value-level rules (`addStepToValue` / `stepByDigit` / `stepByPrecision` /
 * `stepByRule`). `numericCaret.ts` is the facade that picks between them.
 */
import { clampCaret, frontCaretIndex, numberParts, type PlacePlan } from "./caretDigits.js";
import { decimalPlaces, decimalPlacesInText, formatValue } from "./caretFormat.js";
import { softClampTo } from "./caretSign.js";

/** 一次按位权步进的结果：新文本与光标位置。 */
export interface StepResult {
  text: string;
  caret: number;
}

/** A step over the whole value (no caret involved). */
export interface ValueStep {
  text: string;
  value: number;
}

/** Soft bounds for a value step (`origin` = the value before stepping). */
export interface StepBounds {
  lower?: number;
  upper?: number;
}

/** Integer-scaled add/subtract, avoiding binary noise for ordinary decimals. */
function addAtPrecision(current: number, step: number, direction: -1 | 1, places: number): number {
  const scale = 10 ** places;
  if (
    Number.isSafeInteger(scale) &&
    Math.abs(current * scale) <= Number.MAX_SAFE_INTEGER &&
    Math.abs(step * scale) <= Number.MAX_SAFE_INTEGER
  ) {
    return (Math.round(current * scale) + direction * Math.round(step * scale)) / scale;
  }
  return current + direction * step;
}

/**
 * Magnitude after stepping `10 ** place`, rounded to `places`, never below zero.
 * `places` is both the rounding width and the text width, so a carry keeps its
 * padding (`23.49` ↑ → `23.50`).
 */
function roundMagnitude(
  magnitude: number,
  direction: -1 | 1,
  place: number,
  places: number,
): number {
  const stepped = magnitude + direction * 10 ** place;
  const clamped = stepped < 0 ? 0 : stepped;
  const rounded = Number(clamped.toFixed(places));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Length of `magnitude` written with its explicit sign, before stripping. */
function unstrippedLength(
  magnitude: number,
  places: number,
  negative: boolean,
  explicitPlus: boolean,
): number {
  const sign = magnitude === 0 ? "" : negative ? "-" : explicitPlus ? "+" : "";
  return sign.length + magnitude.toFixed(places).length;
}

/**
 * Caret after a caret-relative step: front / after-dot pin the caret at a fixed
 * spot, a digit rides the length delta measured on the *unstripped* text (the
 * delta only ever adds / removes characters before it).
 */
function caretForPlan(plan: PlacePlan, nextText: string, caret: number, delta: number): number {
  if (plan.kind === "digit") return clampCaret(caret + delta, nextText.length);
  if (plan.kind === "front" && !plan.intoFraction) return frontCaretIndex(nextText);
  const dotIndex = nextText.indexOf(".");
  return dotIndex >= 0 ? dotIndex + 1 : frontCaretIndex(nextText);
}

/**
 * Apply a resolved place plan: step the magnitude, format with the field's
 * width, and return the new text + caret (cases 2–4 of `src/lib/components/widgets/inputs/README.md`). An
 * explicit `+` survives stepping (`+5` ↑ → `+6`); only case 5 removes it.
 */
export function applyCaretStep(
  text: string,
  value: number,
  caret: number,
  direction: -1 | 1,
  plan: PlacePlan,
): StepResult {
  const parts = numberParts(text);
  const explicitPlus = text.startsWith("+");
  const strip = plan.kind === "afterDot";
  const places = Math.max(decimalPlacesInText(text), Math.max(0, -plan.place));
  const magnitude = roundMagnitude(Math.abs(value), direction, plan.place, places);
  const signed = magnitude === 0 ? 0 : parts.negative ? -magnitude : magnitude;
  const body = formatValue(signed, places, strip);
  const nextText = explicitPlus && magnitude !== 0 ? `+${body}` : body;
  const delta = unstrippedLength(magnitude, places, parts.negative, explicitPlus) - text.length;
  return { text: nextText, caret: caretForPlan(plan, nextText, caret, delta) };
}

/**
 * Add/subtract `amount` to the value in `text`: `places` is both the rounding
 * width and the text width, so a carry keeps its padding (`23.49` ↑ → `23.50`).
 * Shared core of `addStepToValue` and the `stepBy*` family below.
 */
function stepValue(
  text: string,
  direction: -1 | 1,
  amount: number,
  places: number,
  bounds: StepBounds = {},
): ValueStep {
  const trimmed = text.trim();
  const current = trimmed === "" ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(current) || !Number.isFinite(amount)) return { text, value: current };
  const stepped = addAtPrecision(current, amount, direction, places);
  const bounded = softClampTo(stepped, current, bounds.lower, bounds.upper);
  const normalized = Object.is(bounded, -0) ? 0 : bounded;
  const body = formatValue(normalized, places);
  const nextText = text.startsWith("+") && normalized > 0 ? `+${body}` : body;
  return { text: nextText, value: normalized };
}

/**
 * Step the *value* (not the magnitude) by a fixed amount: `←`/`→` at the text
 * edges and the ± buttons use this. Sign is free to change, so this is the way
 * to cross zero.
 */
export function addStepToValue(text: string, direction: -1 | 1, step: number): StepResult {
  const places = Math.max(decimalPlacesInText(text), decimalPlaces(step));
  const result = stepValue(text, direction, step, places);
  return { text: result.text, caret: result.text.length };
}

/**
 * How the slider picks a step amount: `digit` = 智能整数位 (leading significant
 * digit), `step` = the caller's `step` prop, `precision` = 用户输入的最大精度.
 */
export type StepRule = "digit" | "step" | "precision";

/** Each end of the slider owns a third of the bar; the middle third is `step`. */
const SLIDER_ZONE = 1 / 3;

/**
 * The `step` prop as a step amount: missing means the HTML default `1`, a
 * non-numeric value (`"any"`) means "no quantum" (`undefined`).
 */
export function stepAmount(declared: number | string | null | undefined): number | undefined {
  if (declared === undefined || declared === null || declared === "") return 1;
  const amount = numericAttribute(declared);
  return amount !== undefined && amount > 0 ? amount : undefined;
}

/**
 * Parse an optional numeric HTML attribute (`min` / `max` / `step`). Empty
 * strings and non-numeric values (`"any"`) read as `undefined`.
 */
export function numericAttribute(
  candidate: number | string | null | undefined,
): number | undefined {
  if (candidate === "" || candidate === null || candidate === undefined) return undefined;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Rule for a position along the bar (`0` = minus end, `1` = plus end). */
export function stepRuleAt(ratio: number): StepRule {
  if (!Number.isFinite(ratio)) return "step";
  if (ratio < SLIDER_ZONE) return "digit";
  if (ratio > 1 - SLIDER_ZONE) return "precision";
  return "step";
}

/** Place of the leading significant digit: `1.12` → 0, `0.12` → -1, `0.02` → -2. */
export function significantPlace(value: number): number {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(magnitude) || magnitude === 0) return 0;
  // `Math.log10` can land on either side of a power of ten (`log10(0.001)`);
  // snap with exact comparisons instead of trusting the float.
  let place = Math.floor(Math.log10(magnitude));
  while (magnitude < 10 ** place) place -= 1;
  while (magnitude >= 10 ** (place + 1)) place += 1;
  return place;
}

/**
 * 智能整数位 step: add/subtract `10 ** place` of the leading significant digit,
 * so the step coarsens and refines with the value itself —
 * `1.12 → 0.12 → 0.02 → 0.01 → 0.009` going down (智能小数位 takes over once the
 * value *is* the place, so it approaches 0 forever instead of collapsing to 0).
 */
export function stepByDigit(text: string, direction: -1 | 1, bounds: StepBounds = {}): ValueStep {
  const current = Number(text.trim());
  if (!Number.isFinite(current)) return { text, value: current };
  let place = significantPlace(current);
  if (direction < 0 && Math.abs(current) === 10 ** place) place -= 1;
  const places = Math.max(decimalPlacesInText(text), Math.max(0, -place));
  return stepValue(text, direction, 10 ** place, places, bounds);
}

/**
 * 用户最大精度 step: add/subtract the smallest place the user actually typed,
 * trailing zeros included (`0.499 → 0.500 → 0.501`; `5` → `6`; `5.0` → `5.1`).
 * Deleting the extra digits is how the user asks for a coarser step.
 */
export function stepByPrecision(
  text: string,
  direction: -1 | 1,
  bounds: StepBounds = {},
): ValueStep {
  const places = decimalPlacesInText(text);
  return stepValue(text, direction, 10 ** -places, places, bounds);
}

/** Options for `stepByRule` (the slider's three zones). */
export interface StepRuleOptions extends StepBounds {
  /** The caller's `step` prop; missing / non-numeric falls back to `precision`. */
  step?: number;
}

/** Dispatch on `StepRule`; `step` is what the middle zone of the slider uses. */
export function stepByRule(
  text: string,
  direction: -1 | 1,
  rule: StepRule,
  options: StepRuleOptions = {},
): ValueStep {
  if (rule === "digit") return stepByDigit(text, direction, options);
  const step = options.step;
  if (rule === "precision" || step === undefined || !Number.isFinite(step) || step <= 0) {
    return stepByPrecision(text, direction, options);
  }
  const places = Math.max(decimalPlacesInText(text), decimalPlaces(step));
  return stepValue(text, direction, step, places, options);
}
