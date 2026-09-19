/**
 * Types of the pure layer-tree behaviour layer (`src/lib/layers/tree/`).
 *
 * These modules are the implementation of `docs/tree.md`: they know nothing
 * about Svelte, the DOM or storage, so the whole tree interaction model can be
 * unit tested with `bun test` (same split as `inputs/numericCaret.ts`).
 *
 * Every key is a `node_index` of `UiLayerTreeNode` (protocol index, globally
 * unique inside one document) — see docs/tree.md §3.11.
 */
import type { UiLayerTreeNode } from "../types.js";

/** Globally unique row key: the protocol `node_index` of the node. */
export type TreeKey = number;

/**
 * One flattened, renderable row. `level` is 1-based (the root row is level 1),
 * `parentKey` is `null` for the root row, and `textValue` is the string the
 * tree knows about the row (typeahead / a11y) — independent from whatever the
 * row renders, which is what makes inline renaming possible without changing
 * the collection.
 */
export interface TreeRow {
  key: TreeKey;
  parentKey: TreeKey | null;
  level: number;
  hasChildren: boolean;
  textValue: string;
  data: UiLayerTreeNode;
}

/** Where a dragged item goes relative to a row (Blender outliner semantics). */
export type DropPosition = "on" | "before" | "after";

/**
 * Resolved drop target. `root` appends to the document root group (the area
 * below the last row); `item/on` nests into that row (it must be a group),
 * `item/before` and `item/after` insert as siblings of that row.
 */
export type DropTarget = { type: "root" } | { type: "item"; key: TreeKey; position: DropPosition };

/**
 * Pure-data row layout used by `dropTargetFromPoint`. `rowHeight` and `indent`
 * are CSS px; `scrollTop` is the scroll offset of the row viewport, so `point`
 * stays in viewport coordinates and never has to be corrected by the caller.
 */
export interface RowLayout {
  rowHeight: number;
  /** Per-level indent in CSS px (the row's own level indent is `(level-1)*indent`). */
  indent: number;
  scrollTop: number;
}

/** A point in the row viewport's own coordinate space (left/top edge = origin). */
export interface DropPoint {
  x: number;
  y: number;
}
