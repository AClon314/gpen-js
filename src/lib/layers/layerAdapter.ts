/**
 * Protocol → UI layer tree adapter (FBS-007).
 *
 * Maps a structurally parsed, trusted `GpenT` (generated object API,
 * camelCase) into the UI
 * layer tree used by the layer panel and the renderer:
 *
 * - tree structure from `GpenT.nodes` (`type`/`itemIndex`/`parentIndex`),
 *   with payloads resolved from `GpenT.layers` / `GpenT.groups`;
 * - sibling order from the adjacency vector: each group's `childRange`
 *   slices `GpenT.childIndices` to get its immediate children in C list
 *   order — NOT the `nodes` array order;
 * - `activeNodeIndex` marks the active node;
 * - draw order from a pre-order traversal (`flattenedDrawOrder`). CSS
 *   z-index is not a protocol field; renderers must not override this order.
 *
 * Pure functions only: no Svelte state, no DOM, no storage access. The
 * generated object is trusted after structural parsing. Malformed indexes
 * are skipped defensively while building the best available tree.
 *
 * Assembly is two-phase: first index the document (group nodes, child slices,
 * root), then recursively build nodes. That keeps each step small instead of
 * doing lookups and traversal in one large function.
 */
import type { IndexRangeT, LayerGroupT, LayerT, LayerTreeNodeT } from "gpen-protocol/flatbuffers";

import { GpenT } from "../protocol/codec";
import { NONE_INDEX } from "../protocol/constants";
import { LAYER_NODE_GROUP, LAYER_NODE_LAYER } from "./types";
import type {
  UiLayerGroupNode,
  UiLayerNode,
  UiLayerTree,
  UiLayerTreeNode,
  UiLayerTreeNodeBase,
} from "./types";

/** Common node fields shared by layers and groups. */
type NodeBase = Omit<UiLayerTreeNodeBase, "kind" | "children">;

/** The empty result used for documents without a usable root. */
function emptyTree(): UiLayerTree {
  return { root: null, active_node: null, flattenedDrawOrder: () => [] };
}

/** Generated `*T` string fields may be bytes; normalize to the UI contract. */
function nodeName(value: LayerTreeNodeT["name"]): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}

/** Build the common node fields shared by layers and groups. */
function baseNode(node: LayerTreeNodeT, nodeIndex: number, activeNodeIndex: number): NodeBase {
  return {
    node_index: nodeIndex,
    name: nodeName(node.name),
    flags: node.flags,
    color: node.color,
    parent_index: node.parentIndex,
    active: nodeIndex === activeNodeIndex,
  };
}

/** True when `range` slices `childIndices` without leaving it. */
function isValidChildRange(
  range: IndexRangeT | null | undefined,
  childIndicesLength: number,
): range is IndexRangeT {
  return (
    !!range &&
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.len) &&
    range.start >= 0 &&
    range.len >= 0 &&
    range.start + range.len <= childIndicesLength
  );
}

/** Map each group payload index to the node that references it. */
function collectGroupNodeIndexes(
  nodes: readonly LayerTreeNodeT[],
  groups: readonly LayerGroupT[],
): Map<number, number> {
  const nodeIndexOfGroup = new Map<number, number>();
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (!node) continue;
    if (node.type === LAYER_NODE_GROUP && node.itemIndex >= 0 && groups[node.itemIndex]) {
      nodeIndexOfGroup.set(node.itemIndex, nodeIndex);
    }
  }
  return nodeIndexOfGroup;
}

/**
 * Sibling order comes exclusively from the adjacency vector: slice
 * `childIndices` by each group's `childRange`. The `nodes` array order is
 * arbitrary and must not leak into the tree. Structural parsing does not
 * enforce semantic indexes, so malformed ranges are ignored instead of
 * letting an untrusted buffer escape this adapter.
 */
function collectChildrenByGroupNode(
  groups: readonly LayerGroupT[],
  childIndices: readonly number[],
  nodeIndexOfGroup: ReadonlyMap<number, number>,
): Map<number, number[]> {
  const childrenByGroupNode = new Map<number, number[]>();
  for (const [groupIndex, nodeIndex] of nodeIndexOfGroup) {
    const range = groups[groupIndex]?.childRange;
    if (!isValidChildRange(range, childIndices.length)) continue;
    childrenByGroupNode.set(nodeIndex, childIndices.slice(range.start, range.start + range.len));
  }
  return childrenByGroupNode;
}

/** The root is the first node whose parentIndex is the sentinel. */
function findRootIndex(nodes: readonly LayerTreeNodeT[]): number {
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    if (nodes[nodeIndex].parentIndex === NONE_INDEX) return nodeIndex;
  }
  // A malformed graph may have several roots; choosing one is a safe
  // deterministic fallback, and no root at all yields -1.
  return -1;
}

/** True when `nodeIndex` is a real node that is not already on the path. */
function isTraversableNode(
  nodeIndex: number,
  nodeCount: number,
  path: ReadonlySet<number>,
): boolean {
  return (
    Number.isSafeInteger(nodeIndex) &&
    nodeIndex >= 0 &&
    nodeIndex < nodeCount &&
    !path.has(nodeIndex)
  );
}

/** Build a leaf layer node, or `null` when its payload is missing. */
function buildLayerNode(
  node: LayerTreeNodeT,
  nodeIndex: number,
  activeNodeIndex: number,
  layers: readonly LayerT[],
): UiLayerNode | null {
  const layer = layers[node.itemIndex];
  if (!layer) return null;
  return {
    ...baseNode(node, nodeIndex, activeNodeIndex),
    kind: LAYER_NODE_LAYER,
    item_index: node.itemIndex,
    opacity: layer.opacity,
    blend_mode: layer.blendMode,
    layer,
    children: [],
  };
}

/** Build a group node with its recursively built children. */
function buildGroupNode(
  node: LayerTreeNodeT,
  nodeIndex: number,
  activeNodeIndex: number,
  groups: readonly LayerGroupT[],
  childNodeIndexes: readonly number[],
  buildChild: (childIndex: number) => UiLayerTreeNode | null,
): UiLayerGroupNode | null {
  const group = groups[node.itemIndex];
  if (!group) return null;
  const children = childNodeIndexes
    .map((childIndex) => buildChild(childIndex))
    .filter((child): child is UiLayerTreeNode => child !== null);
  return {
    ...baseNode(node, nodeIndex, activeNodeIndex),
    kind: LAYER_NODE_GROUP,
    item_index: node.itemIndex,
    color_tag: group.colorTag,
    group,
    children,
  };
}

/** Draw order: pre-order traversal of the tree, layers only. */
function collectDrawOrder(root: UiLayerTreeNode): UiLayerNode[] {
  const order: UiLayerNode[] = [];
  const visit = (node: UiLayerTreeNode): void => {
    if (node.kind === LAYER_NODE_LAYER) order.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return order;
}

/**
 * Build the UI layer tree for a document.
 */
export function buildLayerTree(document: GpenT): UiLayerTree {
  const { nodes, layers, groups, childIndices, activeNodeIndex } = document;

  const nodeIndexOfGroup = collectGroupNodeIndexes(nodes, groups);
  const childrenByGroupNode = collectChildrenByGroupNode(groups, childIndices, nodeIndexOfGroup);
  const rootIndex = findRootIndex(nodes);
  if (rootIndex < 0) return emptyTree();

  let activeNode: UiLayerTreeNode | null = null;

  function buildNode(nodeIndex: number, path: ReadonlySet<number>): UiLayerTreeNode | null {
    // Child vectors are protocol indexes. Skip out-of-range or cyclic entries
    // defensively; malformed input must not make the pure adapter throw.
    if (!isTraversableNode(nodeIndex, nodes.length, path)) return null;
    const node = nodes[nodeIndex] as LayerTreeNodeT | undefined;
    if (!node) return null;

    const nextPath = new Set(path);
    nextPath.add(nodeIndex);
    const built =
      node.type === LAYER_NODE_LAYER
        ? buildLayerNode(node, nodeIndex, activeNodeIndex, layers)
        : buildGroupNode(
            node,
            nodeIndex,
            activeNodeIndex,
            groups,
            childrenByGroupNode.get(nodeIndex) ?? [],
            (childIndex) => buildNode(childIndex, nextPath),
          );
    if (built?.active) activeNode = built;
    return built;
  }

  const root = buildNode(rootIndex, new Set());
  if (!root) return emptyTree();
  return { root, active_node: activeNode, flattenedDrawOrder: () => collectDrawOrder(root) };
}
