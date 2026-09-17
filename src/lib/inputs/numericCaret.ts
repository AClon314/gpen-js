/**
 * Stepping for a numeric text field, independent of DOM/Svelte.
 *
 * Two layers, one shared core (`stepValue`, `addAtPrecision`, `formatValue`):
 *
 * - **caret-relative** (`stepAtCaret` / `addStepToValue` / `toggleSign`): the
 *   caret picks one decimal place and ↑/↓ add/subtract `10 ** place`. The sign
 *   is separate (case 5) and a step never pushes the magnitude below 0.
 * - **value-level rules** (`stepByDigit` / `stepByPrecision` / `stepByRule`): the
 *   slider's three zones and the ± buttons step the whole value by 智能整数位,
 *   the caller's `step`, or 用户输入的最大精度.
 *
 * Details/tables: `docs/input.md`.
 */

function clampCaret(caret: number, length: number): number {
  const integerCaret = Number.isFinite(caret) ? Math.trunc(caret) : 0;
  return Math.min(length, Math.max(0, integerCaret));
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

/** Number of fractional digits needed to write `text` (exponent-aware). */
export function decimalPlacesInText(text: string): number {
  const normalized = text.trim().toLowerCase();
  const exponentIndex = normalized.indexOf("e");
  const coefficient = exponentIndex < 0 ? normalized : normalized.slice(0, exponentIndex);
  const exponentText = exponentIndex < 0 ? "" : normalized.slice(exponentIndex + 1);
  const exponent = exponentText === "" ? 0 : Number(exponentText);
  const decimalIndex = coefficient.indexOf(".");
  const fractionLength = decimalIndex < 0 ? 0 : coefficient.length - decimalIndex - 1;
  const safeExponent = Number.isFinite(exponent) ? exponent : 0;
  return Math.min(100, Math.max(0, fractionLength - safeExponent));
}

/** Number of fractional digits needed to write `value` (exponent-aware). */
export function decimalPlaces(value: number): number {
  return decimalPlacesInText(String(Math.abs(value)));
}

/** Round to `decimals` fractional digits (no-op when `undefined`); kills `-0`. */
export function roundTo(value: number, decimals: number | undefined): number {
  if (decimals === undefined) return Object.is(value, -0) ? 0 : value;
  const unit = 10 ** -decimals;
  const rounded = Number((Math.round(value / unit) * unit).toFixed(decimals));
  return Object.is(rounded, -0) ? 0 : rounded;
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

/** Format with a fixed decimal width; `strip` also drops trailing fractional zeros. */
function formatMagnitude(magnitude: number, places: number, strip = false): string {
  const fixed = magnitude.toFixed(places);
  if (!strip || !fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

function formatValue(value: number, places: number, strip = false): string {
  const body = formatMagnitude(Math.abs(value), places, strip);
  return value < 0 && body !== "0" ? `-${body}` : body;
}

/** Digits to the left of a caret at index 0 / after a leading sign. */
function frontCaretIndex(text: string): number {
  return text.startsWith("-") || text.startsWith("+") ? 1 : 0;
}

interface NumberParts {
  negative: boolean;
  intStart: number;
  intEnd: number;
  decimalIndex: number;
  fraction: string;
  intDigitCount: number;
}

function numberParts(text: string): NumberParts {
  const negative = text.startsWith("-");
  const intStart = negative || text.startsWith("+") ? 1 : 0;
  const decimalIndex = text.indexOf(".");
  const intEnd = decimalIndex < 0 ? text.length : decimalIndex;
  let intDigitCount = 0;
  for (let index = intStart; index < intEnd; index += 1) {
    if (isDigit(text[index])) intDigitCount += 1;
  }
  return {
    negative,
    intStart,
    intEnd,
    decimalIndex,
    fraction: decimalIndex < 0 ? "" : text.slice(decimalIndex + 1),
    intDigitCount,
  };
}

function leadingDigit(text: string, parts: NumberParts): string {
  for (let index = parts.intStart; index < parts.intEnd; index += 1) {
    if (isDigit(text[index])) return text[index];
  }
  return "0";
}

/** Decimal place of the digit at `index`: `1` for units, `-1` for tenths. */
function digitPlace(text: string, parts: NumberParts, index: number): number {
  if (parts.decimalIndex >= 0 && index > parts.decimalIndex) {
    return -(index - parts.decimalIndex);
  }
  let digitsToRight = 0;
  for (let cursor = index + 1; cursor < parts.intEnd; cursor += 1) {
    if (isDigit(text[cursor])) digitsToRight += 1;
  }
  return digitsToRight;
}

/** Place of the first non-zero fractional digit, or `undefined` if there is none. */
function firstNonzeroFractionPlace(fraction: string): number | undefined {
  for (let index = 0; index < fraction.length; index += 1) {
    const character = fraction[index];
    if (character >= "1" && character <= "9") return -(index + 1);
  }
  return undefined;
}

/**
 * Place of a caret that sits in front of the number (left edge or after the
 * sign) and whether it lands on a fractional digit afterwards.
 *
 * - `^234` ↑ → `^334` (leading digit's own place, no new digit);
 * - un-carry a leading `1` when going down: `^109` ↓ → `^99`, `^100` ↓ → `^90`;
 * - at the `1`/`0.9` boundary step into the fractional wheel (`^1.0` ↓ → `0.^9`)
 *   — needs a fractional text (`1.0`, not `1`) so an integer field still
 *   counts down to `0`.
 */
function frontStep(
  text: string,
  parts: NumberParts,
  value: number,
  direction: -1 | 1,
): { place: number; intoFraction: boolean } {
  const place = parts.intDigitCount > 0 ? parts.intDigitCount - 1 : 0;
  const carryState = Math.abs(value) === 10 ** place;
  const hasFraction = parts.decimalIndex >= 0;
  if (
    direction < 0 &&
    leadingDigit(text, parts) === "1" &&
    (parts.intDigitCount >= 2 || (carryState && hasFraction))
  ) {
    return { place: place - 1, intoFraction: place - 1 < 0 };
  }
  return { place, intoFraction: false };
}

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
 * Step caret-relative (cases 1–5 of `InputNumber.md`). `direction` is `1` for
 * ↑ / wheel-up and `-1` for ↓ / wheel-down. A non-numeric text is returned
 * unchanged.
 */
export function stepAtCaret(text: string, caret: number, direction: -1 | 1): StepResult {
  const safeCaret = clampCaret(caret, text.length);
  const trimmed = text.trim();
  const value = trimmed === "" ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(value)) return { text, caret: safeCaret };

  const parts = numberParts(text);
  const front = frontCaretIndex(text);
  const explicitPlus = text.startsWith("+");

  // case 5: caret left of the sign toggles it (keeping an explicit `+`).
  if (safeCaret === 0 && (text.startsWith("-") || explicitPlus)) {
    return toggleSign(text, 0);
  }

  const leftCharacter = safeCaret > 0 ? text[safeCaret - 1] : undefined;
  let place: number;
  let plan: "front" | "afterDot" | "digit";
  let caretIntoFraction = false;

  if (safeCaret <= front || (leftCharacter !== "." && !isDigit(leftCharacter))) {
    // case 3 (and unknown surroundings: exponents / stray chars): in front.
    ({ place, intoFraction: caretIntoFraction } = frontStep(text, parts, value, direction));
    plan = "front";
  } else if (leftCharacter === ".") {
    // case 4: activate / walk the fractional wheel from its first non-zero digit.
    if (parts.fraction.length === 0) return { text: `${text}0`, caret: safeCaret };
    place = firstNonzeroFractionPlace(parts.fraction) ?? -1;
    if (direction < 0 && Math.abs(value) - 10 ** place === 0) {
      place -= 1; // extend precision instead of collapsing to 0: `0.^01` ↓ → `0.^009`.
    }
    plan = "afterDot";
  } else {
    // case 2: the place of the digit to the left of the caret.
    place = digitPlace(text, parts, safeCaret - 1);
    plan = "digit";
  }

  // case 2 / 3 keep the field's fractional width, so a carry keeps its zeros
  // (`23.49` ↑ → `23.50`, not `23.5`). case 4 lets the width follow the active
  // place and drops trailing zeros (`0.009` ↑ → `0.01`, `0.09` ↑ → `0.1`).
  const strip = plan === "afterDot";
  const places = Math.max(decimalPlacesInText(text), Math.max(0, -place));
  let magnitude = Math.abs(value) + direction * 10 ** place;
  if (magnitude < 0) magnitude = 0;
  const rounded = Number(magnitude.toFixed(places));
  const nextMagnitude = Object.is(rounded, -0) ? 0 : rounded;
  const signed = nextMagnitude === 0 ? 0 : parts.negative ? -nextMagnitude : nextMagnitude;
  let nextText = formatValue(signed, places, strip);
  // An explicit `+` survives stepping (`+5` ↑ → `+6`); case 5 is what removes it.
  if (explicitPlus && nextMagnitude !== 0) nextText = `+${nextText}`;

  // The caret is pinned for front / after-dot; for a digit it rides the length
  // delta measured on the *unstripped* text (stripping only removes characters
  // after it), then is clamped to the shortened text.
  const unstrippedSign = nextMagnitude === 0 ? "" : parts.negative ? "-" : explicitPlus ? "+" : "";
  const unstripped = `${unstrippedSign}${nextMagnitude.toFixed(places)}`;
  const nextCaret =
    plan === "front"
      ? caretIntoFraction && nextText.includes(".")
        ? nextText.indexOf(".") + 1
        : frontCaretIndex(nextText)
      : plan === "afterDot"
        ? nextText.includes(".")
          ? nextText.indexOf(".") + 1
          : frontCaretIndex(nextText)
        : clampCaret(safeCaret + (unstripped.length - text.length), nextText.length);

  return { text: nextText, caret: nextCaret };
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
): StepResult {
  const trimmed = text.trim();
  if (trimmed === "" || !Number.isFinite(Number(trimmed))) return { text, caret };
  const safeCaret = clampCaret(caret, text.length);
  const negative = text.startsWith("-");
  const explicitPositive = text.startsWith("+");
  const body = negative || explicitPositive ? text.slice(1) : text;

  // `+` forces positive (only a `-` needs flipping); `-` forces negative.
  if (target === "positive" && !negative) return { text, caret: safeCaret };
  if (target === "negative" && negative) return { text, caret: safeCaret };
  // Cycling keeps an explicit sign: `-5` ⇄ `+5`; an unsigned number gains `-`.
  if (negative) return { text: `+${body}`, caret: safeCaret };
  if (explicitPositive) return { text: `-${body}`, caret: safeCaret };
  return { text: `-${text}`, caret: safeCaret + 1 };
}
