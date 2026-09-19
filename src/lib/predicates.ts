/**
 * Shared boolean predicates for the command registry and the menu model.
 *
 * Both layers accept `boolean | (() => boolean) | undefined` for `when` /
 * `enabled` / `disabled`, and both must degrade gracefully: a predicate that
 * throws may not take down the whole menu or the whole keymap. Keeping the
 * evaluation in one place means the two registries cannot drift apart on the
 * "missing = fallback" and "throws = false" rules.
 */

/** The accepted shapes for `when` / `enabled` / `disabled`. */
export type BooleanSource = boolean | (() => boolean) | undefined;

/**
 * Evaluate a predicate.
 *
 * - `undefined` → `fallback` (the caller's default, e.g. "visible" / "enabled");
 * - a boolean is returned as-is;
 * - a function is called, and **a throw is reported and treated as `false`**
 *   (fail closed: an un-runnable command must not be offered as runnable).
 *
 * `label` only shows up in the diagnostic.
 */
export function evaluatePredicate(
  source: BooleanSource,
  fallback: boolean,
  label: string,
): boolean {
  if (source === undefined) return fallback;
  if (typeof source === "boolean") return source;
  try {
    return source() === true;
  } catch (error) {
    console.debug(`[gpen] ignored rejection: ${label} predicate`, error);
    return false;
  }
}
