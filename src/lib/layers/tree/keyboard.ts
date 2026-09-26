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

/** 树内聚焦移动方向。 */
export type TreeMove = "up" | "down" | "left" | "right" | "home" | "end";

/** 按移动方向返回下一个应聚焦的行键。 */
export function nextFocusKey(
  rows: readonly TreeRow[],
  current: TreeKey | undefined,
  move: TreeMove,
): TreeKey | undefined {
  if (rows.length === 0) return undefined;

  const index = current === undefined ? -1 : rowIndex(rows, current);
  if (index < 0) return entryKey(rows, move);
  return moveFocus(rows, index, move);
}

/**
 * Key to focus when the tree is entered without a focused row (or the previous
 * focus is no longer visible): `end`/`up` land on the last row, the rest on the
 * first.
 */
function entryKey(rows: readonly TreeRow[], move: TreeMove): TreeKey {
  return move === "end" || move === "up" ? rows[rows.length - 1].key : rows[0].key;
}

/** True when the row at `index` is expanded (its next row is deeper). */
function isExpanded(rows: readonly TreeRow[], index: number): boolean {
  const row = rows[index];
  const next = rows[index + 1];
  // In a flat pre-order list the children of `row` are exactly the following
  // rows with a deeper level, so `next.level > row.level` means "expanded".
  return next !== undefined && next.level > row.level;
}

/** `up`: previous row, unless the first row is already focused. */
function precedingKey(rows: readonly TreeRow[], index: number): TreeKey {
  return index > 0 ? rows[index - 1].key : rows[index].key;
}

/** `down`: next row, unless the last row is already focused. */
function followingKey(rows: readonly TreeRow[], index: number): TreeKey {
  return index < rows.length - 1 ? rows[index + 1].key : rows[index].key;
}

/** `right`: enter the first child, or keep focus to signal "expand". */
function rightKey(rows: readonly TreeRow[], index: number): TreeKey {
  const row = rows[index];
  if (!isExpanded(rows, index)) return row.key;
  return rows[index + 1].key;
}

/** `left`: keep focus to signal "collapse", otherwise go to the parent row. */
function leftKey(rows: readonly TreeRow[], index: number): TreeKey {
  const row = rows[index];
  if (isExpanded(rows, index)) return row.key;
  return row.parentKey ?? row.key;
}

/** Positional move for a focused row; always lands on a concrete key. */
function moveFocus(rows: readonly TreeRow[], index: number, move: TreeMove): TreeKey {
  switch (move) {
    case "up":
      return precedingKey(rows, index);
    case "down":
      return followingKey(rows, index);
    case "home":
      return rows[0].key;
    case "end":
      return rows[rows.length - 1].key;
    case "right":
      return rightKey(rows, index);
    case "left":
      return leftKey(rows, index);
  }
}
