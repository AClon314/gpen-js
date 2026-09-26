/**
 * Caret / digit parsing for the caret-relative stepper, DOM/Svelte-free.
 *
 * `numberParts` is the single parse of a numeric text; `planCaretStep` turns
 * "text + caret + direction" into a `CaretPlan` (which zone the caret is in and
 * which decimal place to step). The formatting / value math lives in
 * `caretFormat.ts` and `caretStep.ts`.
 */

/** Clamp a caret to `[0, length]`, tolerating a non-finite caret. */
export function clampCaret(caret: number, length: number): number {
  const integerCaret = Number.isFinite(caret) ? Math.trunc(caret) : 0;
  return Math.min(length, Math.max(0, integerCaret));
}

/** True when `character` is an ASCII decimal digit. */
export function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

/** Digits to the left of a caret at index 0 / after a leading sign. */
export function frontCaretIndex(text: string): number {
  return text.startsWith("-") || text.startsWith("+") ? 1 : 0;
}

/** The sign / integer / fractional pieces of a numeric text. */
export interface NumberParts {
  negative: boolean;
  intStart: number;
  intEnd: number;
  decimalIndex: number;
  fraction: string;
  intDigitCount: number;
}

/** Parse `text` into its sign / integer / fractional pieces (one pass). */
export function numberParts(text: string): NumberParts {
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

/** First digit of the integer part (`"0"` when there is none). */
function leadingDigit(text: string, parts: NumberParts): string {
  for (let index = parts.intStart; index < parts.intEnd; index += 1) {
    if (isDigit(text[index])) return text[index];
  }
  return "0";
}

/** Decimal place of the digit at `index`: `1` for units, `-1` for tenths. */
export function digitPlace(text: string, parts: NumberParts, index: number): number {
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
export function firstNonzeroFractionPlace(fraction: string): number | undefined {
  for (let index = 0; index < fraction.length; index += 1) {
    const character = fraction[index];
    if (character >= "1" && character <= "9") return -(index + 1);
  }
  return undefined;
}

/**
 * Whether a caret in front of the number un-carries a leading `1` going down
 * (`^109` ↓ → `^99`, `^100` ↓ → `^90`); with a fraction it also steps into the
 * fractional wheel (`^1.0` ↓ → `0.^9`).
 */
function shouldUncarryLeadingOne(
  text: string,
  parts: NumberParts,
  value: number,
  direction: -1 | 1,
  place: number,
): boolean {
  if (direction >= 0 || leadingDigit(text, parts) !== "1") return false;
  if (parts.intDigitCount >= 2) return true;
  return Math.abs(value) === 10 ** place && parts.decimalIndex >= 0;
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
export function frontStep(
  text: string,
  parts: NumberParts,
  value: number,
  direction: -1 | 1,
): { place: number; intoFraction: boolean } {
  const place = parts.intDigitCount > 0 ? parts.intDigitCount - 1 : 0;
  if (!shouldUncarryLeadingOne(text, parts, value, direction, place)) {
    return { place, intoFraction: false };
  }
  return { place: place - 1, intoFraction: place - 1 < 0 };
}

/** True when the text carries an explicit `+` or `-`. */
function hasSignPrefix(text: string): boolean {
  return text.startsWith("-") || text.startsWith("+");
}

/** Which zone the caret sits in: in front / right of the dot / right of a digit. */
function caretZone(text: string, caret: number): "front" | "afterDot" | "digit" {
  if (caret <= frontCaretIndex(text)) return "front";
  const left = text[caret - 1];
  if (left === ".") return "afterDot";
  return isDigit(left) ? "digit" : "front";
}

/**
 * Place for a caret right of the decimal point: the first non-zero fractional
 * digit, or one place finer when going down would collapse the value to zero
 * (`0.^01` ↓ → `0.^009`).
 */
function afterDotPlace(fraction: string, value: number, direction: -1 | 1): number {
  const place = firstNonzeroFractionPlace(fraction) ?? -1;
  const collapsesToZero = direction < 0 && Math.abs(value) - 10 ** place === 0;
  return collapsesToZero ? place - 1 : place;
}

/** A caret plan that actually steps a place (`front` / `afterDot` / `digit`). */
export type PlacePlan =
  | { kind: "front"; place: number; intoFraction: boolean }
  | { kind: "afterDot"; place: number }
  | { kind: "digit"; place: number };

/**
 * Where the caret is and what the step should do (cases 2–5 of
 * `src/lib/components/widgets/inputs/README.md`): toggle the sign, append a zero, or step one place.
 */
export type CaretPlan =
  | { kind: "toggle" }
  | { kind: "insert"; text: string; caret: number }
  | PlacePlan;

/**
 * Resolve the `CaretPlan` for one ↑/↓ step at `caret`: case 5 (left of the
 * sign), case 3 (in front of the number), case 4 (right of the dot) and case 2
 * (right of a digit). `value` is the already-parsed finite value of `text`.
 */
export function planCaretStep(
  text: string,
  caret: number,
  direction: -1 | 1,
  value: number,
): CaretPlan {
  const parts = numberParts(text);
  if (caret === 0 && hasSignPrefix(text)) return { kind: "toggle" };
  const zone = caretZone(text, caret);
  if (zone === "front") {
    const step = frontStep(text, parts, value, direction);
    return { kind: "front", place: step.place, intoFraction: step.intoFraction };
  }
  if (zone === "afterDot") {
    if (parts.fraction.length === 0) return { kind: "insert", text: `${text}0`, caret };
    return { kind: "afterDot", place: afterDotPlace(parts.fraction, value, direction) };
  }
  return { kind: "digit", place: digitPlace(text, parts, caret - 1) };
}

/** The finite numeric value of `text`, or `undefined` (empty / non-numeric). */
export function parseNumericText(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}
