/**
 * Flattening the nested `UiLayerTreeNode` tree into rows.
 *
 * `visibleRows` is the single flattened entry point for rendering: folding a
 * node simply removes its whole subtree from the result, so the component
 * layer never re-derives the list from anywhere else (docs/tree.md §3.5).
 */
import type { UiLayerTreeNode } from "../types.js";
import type { TreeKey, TreeRow } from "./types.js";

/** Pre-order flattening of the whole tree (ignores any expansion state). */
export function flattenRows(root: UiLayerTreeNode | null): TreeRow[] {
  return collectRows(root, null);
}

/**
 * Pre-order rows the user can actually see: the root row is always visible,
 * a node's children are only included when the node's key is in `expanded`.
 */
export function visibleRows(
  root: UiLayerTreeNode | null,
  expanded: ReadonlySet<TreeKey>,
): TreeRow[] {
  return collectRows(root, expanded);
}

function collectRows(
  root: UiLayerTreeNode | null,
  expanded: ReadonlySet<TreeKey> | null,
): TreeRow[] {
  const rows: TreeRow[] = [];
  if (!root) return rows;

  const visit = (node: UiLayerTreeNode, parentKey: TreeKey | null, level: number): void => {
    rows.push({
      key: node.node_index,
      parentKey,
      level,
      hasChildren: node.children.length > 0,
      textValue: node.name,
      data: node,
    });
    if (expanded && !expanded.has(node.node_index)) return;
    for (const child of node.children) visit(child, node.node_index, level + 1);
  };

  visit(root, null, 1);
  return rows;
}

/** Index of a key in a row list, or `-1` when the row is not visible. */
export function rowIndex(rows: readonly TreeRow[], key: TreeKey): number {
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].key === key) return index;
  }
  return -1;
}

/** Row for a key, or `undefined` when the row is not visible. */
export function rowByKey(rows: readonly TreeRow[], key: TreeKey): TreeRow | undefined {
  const index = rowIndex(rows, key);
  return index < 0 ? undefined : rows[index];
}
