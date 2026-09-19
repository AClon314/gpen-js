/**
 * Drop → structural move ops.
 *
 * `applyDrop` is the pure half of drag & drop: it turns a resolved
 * `DropTarget` plus the dragged keys into `TreeOp`s and never touches the
 * document. Applying the ops is `layerOps.moveNodes`.
 *
 * Rules:
 * - `{type:'root'}` and `item/on` append to the end of the destination group's
 *   child list (later siblings paint above earlier ones, docs/layers order);
 * - `item/before` inserts before that row, `item/after` inserts before the
 *   row's next sibling (or appends when it is the last child);
 * - a key is skipped when the destination is inside its own subtree, when it
 *   would insert the node before itself, or when it is already in place — a
 *   pure function must not emit self-referential or no-op ops.
 */
import { flattenRows, rowByKey } from "./rows.js";
import type { DropTarget, TreeKey, TreeRow } from "./types.js";
import type { UiLayerTreeNode } from "../types.js";

/** Move one node under `parentKey`, before `beforeKey` (append when omitted). */
export interface MoveTreeOp {
  kind: "move";
  key: TreeKey;
  parentKey: TreeKey;
  beforeKey?: TreeKey;
}

/** Every structural change the tree layer can ask the document layer for. */
export type TreeOp = MoveTreeOp;

export function applyDrop(
  tree: UiLayerTreeNode,
  keys: readonly TreeKey[],
  target: DropTarget,
): TreeOp[] {
  const rows = flattenRows(tree);
  const destination = resolveDestination(rows, tree, target);
  if (!destination) return [];

  const { parentKey, beforeKey } = destination;
  const ops: TreeOp[] = [];
  for (const key of keys) {
    const row = rowByKey(rows, key);
    if (!row) continue;
    // Destination inside the moved subtree (including the node itself).
    if (isInsideSubtree(rows, key, parentKey)) continue;
    if (beforeKey === key) continue;
    if (isInPlace(rows, row, parentKey, beforeKey)) continue;
    const op: MoveTreeOp = { kind: "move", key, parentKey };
    if (beforeKey !== undefined) op.beforeKey = beforeKey;
    ops.push(op);
  }
  return ops;
}

interface Destination {
  parentKey: TreeKey;
  beforeKey?: TreeKey;
}

function resolveDestination(
  rows: readonly TreeRow[],
  tree: UiLayerTreeNode,
  target: DropTarget,
): Destination | undefined {
  if (target.type === "root") return { parentKey: tree.node_index };
  const row = rowByKey(rows, target.key);
  if (!row) return undefined;
  if (target.position === "on") return { parentKey: row.key };
  // `before`/`after` the root row has no sibling slot.
  if (row.parentKey === null) return undefined;
  if (target.position === "before") return { parentKey: row.parentKey, beforeKey: row.key };
  const next = nextSiblingKey(rows, row);
  return next === undefined
    ? { parentKey: row.parentKey }
    : { parentKey: row.parentKey, beforeKey: next };
}

function nextSiblingKey(rows: readonly TreeRow[], row: TreeRow): TreeKey | undefined {
  if (row.parentKey === null) return undefined;
  const siblings = rowByKey(rows, row.parentKey)?.data.children ?? [];
  const index = siblings.findIndex((child) => child.node_index === row.key);
  if (index < 0) return undefined;
  return siblings[index + 1]?.node_index;
}

/** True when `candidate` is `ancestor` itself or one of its descendants. */
function isInsideSubtree(rows: readonly TreeRow[], ancestor: TreeKey, candidate: TreeKey): boolean {
  let cursor: TreeKey | undefined = candidate;
  while (cursor !== undefined) {
    if (cursor === ancestor) return true;
    cursor = rowByKey(rows, cursor)?.parentKey ?? undefined;
  }
  return false;
}

/** True when the move would not change the node's position at all. */
function isInPlace(
  rows: readonly TreeRow[],
  row: TreeRow,
  parentKey: TreeKey,
  beforeKey: TreeKey | undefined,
): boolean {
  if (row.parentKey !== parentKey) return false;
  return nextSiblingKey(rows, row) === beforeKey;
}
