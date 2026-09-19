/**
 * Selection reducer for the tree.
 *
 * Semantics (Blender outliner):
 * - plain click replaces the selection with the clicked row;
 * - ctrl/meta click toggles the clicked row (and may empty the selection —
 *   `disallowEmptySelection` is deliberately not modelled here; the caller can
 *   re-add a row if it wants one);
 * - shift click replaces the selection with the range between the anchor and
 *   the clicked row, over the **visible** rows only (a collapsed subtree cannot
 *   be range-selected);
 * - shift+ctrl is treated as ctrl (toggle wins) — the same rule as most file
 *   managers, and it keeps the reducer single-valued.
 *
 * The anchor is the *last* key of the incoming set in iteration order (Set
 * insertion order = order of selection), which is the row the previous click
 * added last. The result is always built in row order, so after a plain click
 * or a range click the anchor is the most recently clicked row again.
 */
import { rowIndex } from "./rows.js";
import type { TreeKey, TreeRow } from "./types.js";

export interface SelectionModifiers {
  shift: boolean;
  ctrl: boolean;
}

export function selectionAfter(
  rows: readonly TreeRow[],
  selected: ReadonlySet<TreeKey>,
  key: TreeKey,
  modifiers: SelectionModifiers,
): Set<TreeKey> {
  if (modifiers.ctrl) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  if (modifiers.shift) {
    const anchor = lastVisibleSelectedKey(rows, selected);
    if (anchor === undefined) return new Set([key]);
    const from = rowIndex(rows, anchor);
    const to = rowIndex(rows, key);
    if (from < 0 || to < 0) return new Set([key]);
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const next = new Set<TreeKey>();
    for (let index = start; index <= end; index += 1) next.add(rows[index].key);
    return next;
  }

  return new Set([key]);
}

/** Last selected key that is currently visible, in set iteration order. */
function lastVisibleSelectedKey(
  rows: readonly TreeRow[],
  selected: ReadonlySet<TreeKey>,
): TreeKey | undefined {
  let found: TreeKey | undefined;
  for (const candidate of selected) {
    if (rowIndex(rows, candidate) >= 0) found = candidate;
  }
  return found;
}
