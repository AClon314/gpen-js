/**
 * Keyboard focus movement for the tree (APG tree pattern, flat rows).
 *
 * `nextFocusKey` returns the key that should receive focus. Two moves are
 * *structural* rather than positional, and the function signals them by
 * returning the current key unchanged:
 *
 * - `left` on an expanded node collapses it (focus stays on the node),
 * - `right` on a collapsed node with children expands it.
 *
 * Returning the current key is unambiguous because every positional move
 * always returns a different key, and a boundary no-op (e.g. `up` on the first
 * row) also keeps focus where it is. Callers must consult their own expansion
 * state to tell "collapse/expand" from "boundary no-op" — the row list alone
 * cannot distinguish them.
 *
 * No wrap-around: `up` on the first row and `down` on the last row are no-ops.
 */
import { rowIndex } from "./rows.js";
import type { TreeKey, TreeRow } from "./types.js";

export type TreeMove = "up" | "down" | "left" | "right" | "home" | "end";

export function nextFocusKey(
  rows: readonly TreeRow[],
  current: TreeKey | undefined,
  move: TreeMove,
): TreeKey | undefined {
  if (rows.length === 0) return undefined;

  const index = current === undefined ? -1 : rowIndex(rows, current);
  if (index < 0) {
    // No row is focused (or it is no longer visible): entering the tree lands
    // on the last row for `end`/`up`, on the first row for everything else.
    return move === "end" || move === "up" ? rows[rows.length - 1].key : rows[0].key;
  }

  const row = rows[index];
  const next = rows[index + 1];
  // In a flat pre-order list the children of `row` are exactly the following
  // rows with a deeper level, so `next.level > row.level` means "expanded".
  const expanded = next !== undefined && next.level > row.level;

  switch (move) {
    case "up":
      return index > 0 ? rows[index - 1].key : current;
    case "down":
      return index < rows.length - 1 ? rows[index + 1].key : current;
    case "home":
      return rows[0].key;
    case "end":
      return rows[rows.length - 1].key;
    case "right":
      if (expanded) return next.key;
      return current;
    case "left":
      // Expanded → collapse (focus stays); otherwise go to the parent row.
      if (expanded) return current;
      return row.parentKey ?? current;
  }
}
