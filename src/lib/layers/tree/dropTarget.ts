/**
 * Pointer → `DropTarget` resolution (the only place that does it, docs/tree.md
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

export type DropValidator = (target: DropTarget) => boolean;

const BEFORE_BAND = 0.25;
const AFTER_BAND = 0.75;

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
  let position: DropPosition;
  if (fraction < BEFORE_BAND) position = "before";
  else if (fraction > AFTER_BAND) position = "after";
  else position = row.hasChildren ? "on" : "after";

  if (position === "on" && point.x < (row.level - 1) * indent) position = "after";
  if (position === "before" && row.parentKey === null) position = "on";

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
