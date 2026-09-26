/**
 * Pointer → `DropTarget` resolution (the only place that does it, src/lib/layers/tree/README.md
 * §3.6). The geometry follows the Blender outliner:
 *
 * - a row's top and bottom ~25% resolve to `before` / `after` (sibling insert),
 * - the middle 50% resolves to `on` (nest into that row),
 * - a row without children cannot nest, so its middle band resolves to `after`,
 * - a pointer left of the row's own indent (the gutter) also resolves to
 *   `after`: dragging into the indent gutter of a group is the standard
 *   "reorder instead of reparent" gesture,
 * - `before` the root row is impossible and resolves to `on` the root,
 * - below the last row resolves to `{type:'root'}` (append to the root group).
 *
 * `point` is in the row viewport's own space; `layout.scrollTop` is applied
 * here so callers never have to correct for scrolling. `isValid` is the
 * caller's veto (e.g. "never drop a node into its own descendant"); the
 * function returns `null` when the resolved target is vetoed.
 */
import { rowByKey } from "./rows.js";
import type { DropPoint, DropPosition, DropTarget, RowLayout, TreeRow } from "./types.js";

/** 目标合法性校验（返回 false 则整个目标作废）。 */
export type DropValidator = (target: DropTarget) => boolean;

const BEFORE_BAND = 0.25;
const AFTER_BAND = 0.75;

/** Vertical band → position, before the gutter / root corrections. */
function bandPosition(row: TreeRow, fraction: number): DropPosition {
  if (fraction < BEFORE_BAND) return "before";
  if (fraction > AFTER_BAND) return "after";
  // A row without children cannot nest, so its middle band is a sibling insert.
  return row.hasChildren ? "on" : "after";
}

/**
 * Gutter and root corrections: a group's indent gutter reorders instead of
 * nesting, and a row without a parent cannot take a sibling "before".
 */
function adjustPosition(
  row: TreeRow,
  position: DropPosition,
  x: number,
  indent: number,
): DropPosition {
  if (position === "on" && x < (row.level - 1) * indent) return "after";
  if (position === "before" && row.parentKey === null) return "on";
  return position;
}

/** 把指针位置解析成放置目标（before / after / on / root）。 */
export function dropTargetFromPoint(
  rows: readonly TreeRow[],
  point: DropPoint,
  layout: RowLayout,
  isValid: DropValidator,
): DropTarget | null {
  const { rowHeight, indent, scrollTop } = layout;
  if (rows.length === 0 || rowHeight <= 0) return null;

  const contentY = point.y + scrollTop;
  const index = Math.floor(contentY / rowHeight);
  if (index < 0) return null;
  if (index >= rows.length) return accept({ type: "root" }, isValid);

  const row = rows[index];
  const fraction = (contentY - index * rowHeight) / rowHeight;
  const position = adjustPosition(row, bandPosition(row, fraction), point.x, indent);
  return accept({ type: "item", key: row.key, position }, isValid);
}

function accept(target: DropTarget, isValid: DropValidator): DropTarget | null {
  return isValid(target) ? target : null;
}

/** Row at the given point, ignoring `isValid` — handy for drag previews. */
export function rowAtPoint(
  rows: readonly TreeRow[],
  point: DropPoint,
  layout: RowLayout,
): TreeRow | undefined {
  const { rowHeight, scrollTop } = layout;
  if (rows.length === 0 || rowHeight <= 0) return undefined;
  const contentY = point.y + scrollTop;
  const index = Math.floor(contentY / rowHeight);
  if (index < 0 || index >= rows.length) return undefined;
  return rowByKey(rows, rows[index].key);
}
