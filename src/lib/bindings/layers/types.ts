/**
 * UI-facing layer tree model, mapped from the protocol `Gpen` document.
 *
 * UI field names intentionally stay snake_case so UI code and wire data stay
 * traceable; the protocol payload types are the generated object API
 * (`*T` classes from `gpen-protocol/flatbuffers`, camelCase). This module is
 * intentionally free of Svelte state, DOM access and storage I/O:
 * `buildLayerTree` is a pure function of a structurally parsed, trusted `GpenT`.
 */
import type { LayerFlagsT, LayerGroupT, LayerT, Vec3T } from "gpen-protocol/flatbuffers";

/**
 * `LayerTreeNodeKind` wire values (gpen.tsp: `LAYER_TREE_NODE_KIND_*`).
 * A node with kind `LAYER_NODE_LAYER` addresses `Gpen.layers` via
 * `item_index`; a node with kind `LAYER_NODE_GROUP` addresses `Gpen.groups`.
 */
export const LAYER_NODE_LAYER = 0;
export const LAYER_NODE_GROUP = 1;

export type UiNodeKind = typeof LAYER_NODE_LAYER | typeof LAYER_NODE_GROUP;

/**
 * Common node state shared by layers and groups. The concrete node types
 * narrow `kind` to a literal, which makes `UiLayerTreeNode` a discriminated
 * union so UI code can switch on `kind` and get narrowed payloads.
 */
export interface UiLayerTreeNodeBase {
  /** Index of this node in `Gpen.nodes` (protocol index, not a UI ordinal). */
  node_index: number;

  name: string;
  kind: UiNodeKind;

  /** Protocol `LayerFlagsT`; `null` when the document omits the flags table. */
  flags: LayerFlagsT | null;

  /** Dope-sheet channel color (protocol `LayerTreeNode.color`). */
  color: Vec3T | null;

  /** Index of the parent node in `Gpen.nodes`; 0xffffffff for the root. */
  parent_index: number;

  /** True when this node is the document's active node. */
  active: boolean;

  /**
   * Immediate children in protocol order (from `Gpen.child_indices` +
   * `LayerGroup.child_range`). A layer node always has an empty list.
   */
  children: UiLayerTreeNode[];
}

/** UI node for a layer leaf (protocol `Layer`). */
export interface UiLayerNode extends UiLayerTreeNodeBase {
  kind: typeof LAYER_NODE_LAYER;

  /** Index into `Gpen.layers`. */
  item_index: number;

  /** Convenience copies of the durable layer fields UI needs most. */
  opacity: number;
  blend_mode: number;

  /** The full protocol layer (frames/masks/transform/...), read-only. */
  layer: LayerT;
}

/** UI node for a group (protocol `LayerGroup`). */
export interface UiLayerGroupNode extends UiLayerTreeNodeBase {
  kind: typeof LAYER_NODE_GROUP;

  /** Index into `Gpen.groups`. */
  item_index: number;

  /** Icon color tag (`GroupColorTag`). */
  color_tag: number;

  /** The full protocol group, read-only. */
  group: LayerGroupT;
}

/** Any node of the layer tree (discriminated on `kind`). */
export type UiLayerTreeNode = UiLayerNode | UiLayerGroupNode;

/**
 * The layer tree built from one `GpenDocument`.
 *
 * `flattenedDrawOrder()` derives the draw order from a pre-order traversal of
 * the tree: a parent group paints before its children, siblings paint in
 * `child_indices` order. CSS `z-index` is NOT a protocol field and renderers
 * must not use it to override this order; all layer rendering stays inside
 * the document-anchored stacking context, below the Dockview UI band.
 */
export interface UiLayerTree {
  /** The root node (a group in the Blender model), or null for an empty document. */
  root: UiLayerTreeNode | null;

  /** The node referenced by `Gpen.active_node_index`, or null when absent. */
  active_node: UiLayerTreeNode | null;

  /** Draw order: pre-order traversal, layers only, protocol sibling order. */
  flattenedDrawOrder(): UiLayerNode[];
}
