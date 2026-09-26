/**
 * Numeric text formatting and decimal-place counting for the caret stepper,
 * DOM/Svelte-free.
 *
 * `decimalPlacesInText` is exponent-aware (`1e-7` → 7). `formatValue` keeps a
 * fixed decimal width and can strip trailing fractional zeros, which is what
 * case 4 of `src/lib/components/widgets/inputs/README.md` needs (its width follows the active place).
 */

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

/** Format with a fixed decimal width; `strip` also drops trailing fractional zeros. */
function formatMagnitude(magnitude: number, places: number, strip = false): string {
  const fixed = magnitude.toFixed(places);
  if (!strip || !fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

/** Sign + magnitude with a fixed decimal width; `strip` drops trailing zeros. */
export function formatValue(value: number, places: number, strip = false): string {
  const body = formatMagnitude(Math.abs(value), places, strip);
  return value < 0 && body !== "0" ? `-${body}` : body;
}
