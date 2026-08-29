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
 */
import type { LayerTreeNodeT } from "gpen-protocol/flatbuffers";

import { GpenT } from "../flatbuffers/codec";
import { NONE_INDEX } from "../flatbuffers/constants";
import { LAYER_NODE_GROUP, LAYER_NODE_LAYER } from "./types";
import type { UiLayerGroupNode, UiLayerNode, UiLayerTree, UiLayerTreeNode } from "./types";

/**
 * Build the UI layer tree for a document.
 */
export function buildLayerTree(document: GpenT): UiLayerTree {
  const { nodes, layers, groups, childIndices, activeNodeIndex } = document;

  // Map each group payload index to the node that references it, so the
  // children of a group can be found without scanning `nodes` per group.
  const nodeIndexOfGroup = new Map<number, number>();
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (!node) continue;
    if (
      node.type === LAYER_NODE_GROUP &&
      node.itemIndex >= 0 &&
      node.itemIndex < groups.length &&
      groups[node.itemIndex]
    ) {
      nodeIndexOfGroup.set(node.itemIndex, nodeIndex);
    }
  }

  // Sibling order comes exclusively from the adjacency vector: slice
  // `childIndices` by each group's `childRange`. The `nodes` array order is
  // arbitrary and must not leak into the tree.
  const childrenByGroupNode = new Map<number, number[]>();
  for (const [groupIndex, nodeIndex] of nodeIndexOfGroup) {
    const group = groups[groupIndex];
    const range = group?.childRange;
    // Structural parsing does not enforce semantic indexes. Ignore malformed
    // ranges instead of allowing an untrusted buffer to escape this adapter.
    if (
      !range ||
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.len) ||
      range.start < 0 ||
      range.len < 0 ||
      range.start + range.len > childIndices.length
    )
      continue;
    childrenByGroupNode.set(nodeIndex, childIndices.slice(range.start, range.start + range.len));
  }

  // The root is the first node whose parentIndex is the sentinel. A malformed
  // graph may have several roots; choosing one is a safe deterministic fallback.
  let rootIndex = -1;
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    if (nodes[nodeIndex].parentIndex === NONE_INDEX) {
      rootIndex = nodeIndex;
      break;
    }
  }
  if (rootIndex < 0) {
    return { root: null, active_node: null, flattenedDrawOrder: () => [] };
  }

  let activeNode: UiLayerTreeNode | null = null;

  // Generated `*T` string fields are `string | Uint8Array | null`; normalize
  // them for the UI's plain-string contract without adding domain validation.
  function nodeName(value: LayerTreeNodeT["name"]): string {
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return new TextDecoder().decode(value);
    return "";
  }

  function buildNode(nodeIndex: number, path = new Set<number>()): UiLayerTreeNode | null {
    // Child vectors are protocol indexes. Skip out-of-range or cyclic entries
    // defensively; malformed input must not make the pure adapter throw.
    if (
      !Number.isSafeInteger(nodeIndex) ||
      nodeIndex < 0 ||
      nodeIndex >= nodes.length ||
      path.has(nodeIndex)
    )
      return null;
    const node = nodes[nodeIndex] as LayerTreeNodeT | undefined;
    if (!node) return null;
    const nextPath = new Set(path);
    nextPath.add(nodeIndex);
    const base = {
      node_index: nodeIndex,
      name: nodeName(node.name),
      flags: node.flags,
      color: node.color,
      parent_index: node.parentIndex,
      active: nodeIndex === activeNodeIndex,
    };
    if (node.type === LAYER_NODE_LAYER) {
      const layer = layers[node.itemIndex];
      if (!layer) return null;
      const uiNode: UiLayerNode = {
        ...base,
        kind: LAYER_NODE_LAYER,
        item_index: node.itemIndex,
        opacity: layer.opacity,
        blend_mode: layer.blendMode,
        layer,
        children: [],
      };
      if (uiNode.active) activeNode = uiNode;
      return uiNode;
    }
    const group = groups[node.itemIndex];
    if (!group) return null;
    const children = (childrenByGroupNode.get(nodeIndex) ?? [])
      .map((childIndex) => buildNode(childIndex, nextPath))
      .filter((child): child is UiLayerTreeNode => child !== null);
    const uiNode: UiLayerGroupNode = {
      ...base,
      kind: LAYER_NODE_GROUP,
      item_index: node.itemIndex,
      color_tag: group.colorTag,
      group,
      children,
    };
    if (uiNode.active) activeNode = uiNode;
    return uiNode;
  }

  const builtRoot = buildNode(rootIndex);
  if (!builtRoot) return { root: null, active_node: null, flattenedDrawOrder: () => [] };
  const root: UiLayerTreeNode = builtRoot;

  function flattenedDrawOrder(): UiLayerNode[] {
    const order: UiLayerNode[] = [];
    const visit = (node: UiLayerTreeNode): void => {
      if (node.kind === LAYER_NODE_LAYER) order.push(node);
      for (const child of node.children) visit(child);
    };
    visit(root);
    return order;
  }

  return { root, active_node: activeNode, flattenedDrawOrder };
}
