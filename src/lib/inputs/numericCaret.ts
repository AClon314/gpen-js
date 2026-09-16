/**
 * Caret-relative stepping for a numeric text field, independent of DOM/Svelte.
 *
 * Model: **the caret picks one decimal place; ↑/↓ add/subtract `10 ** place`
 * to/from the magnitude**. The sign is separate (case 5), and a step never
 * pushes the magnitude below 0. Details/table: `docs/input.md`.
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
 * edges, the ± buttons and the slider all use this. Sign is free to change, so
 * this is the way to cross zero.
 */
export function addStepToValue(text: string, direction: -1 | 1, step: number): StepResult {
  const trimmed = text.trim();
  const value = trimmed === "" ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(value) || !Number.isFinite(step)) {
    return { text, caret: text.length };
  }

  const places = Math.max(decimalPlacesInText(text), decimalPlaces(step));
  const next = addAtPrecision(value, step, direction, places);
  const rounded = Number(next.toFixed(places));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const nextText = formatValue(normalized, places);
  const signed = text.startsWith("+") && normalized > 0 ? `+${nextText}` : nextText;
  return { text: signed, caret: signed.length };
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
