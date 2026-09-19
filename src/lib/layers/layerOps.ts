import {
  GpenT,
  IndexRangeT,
  LayerGroupT,
  LayerT,
  LayerTreeNodeKind,
  LayerTreeNodeT,
  MimeType,
  RenderBy,
} from "gpen-protocol/flatbuffers";

import { NONE_INDEX } from "../protocol/constants";
import { isDrawableLayer } from "../protocol/defaults";

/**
 * Options for creating a drawing layer.
 */
export interface CreateDrawingLayerOptions {
  /** Insert the new layer immediately after this layer in its group. */
  afterNodeIndex?: number;
}

/**
 * One structural move of a node inside the document (sibling order and
 * parentage). Node indexes are `Gpen.nodes` indexes and stay stable across a
 * move, so a batch of these can be applied in order.
 */
export interface MoveNodeOp {
  /** Node to move (an existing non-root node). */
  nodeIndex: number;
  /** Destination group node index. */
  parentNodeIndex: number;
  /** Insert before this sibling; omitted appends at the end of the group. */
  beforeNodeIndex?: number;
}

const LAYER_NODE_KIND = LayerTreeNodeKind.LAYER_TREE_NODE_KIND_LAYER_UNSPECIFIED;
const GROUP_NODE_KIND = LayerTreeNodeKind.LAYER_TREE_NODE_KIND_GROUP;

/**
 * Create a drawing layer immediately above/after an existing layer.
 *
 * The new node and payload are appended to their respective dense arrays. The
 * adjacency vector is the source of sibling order, so the new node is inserted
 * after the anchor in that vector. Since ranges for all groups share that
 * vector, ranges after the insertion point are shifted as well.
 *
 * This operation does not change `activeNodeIndex` and does not mutate the
 * input document.
 */
export function createDrawingLayer(document: GpenT, opts: CreateDrawingLayerOptions = {}): GpenT {
  const afterNodeIndex = opts.afterNodeIndex ?? document.activeNodeIndex;
  const anchor = document.nodes[afterNodeIndex];

  if (!anchor || anchor.type !== LAYER_NODE_KIND) {
    throw new RangeError(`cannot create a drawing layer after node ${afterNodeIndex}`);
  }

  const parentNodeIndex = anchor.parentIndex;
  const parentNode = document.nodes[parentNodeIndex];
  if (!parentNode || parentNode.type !== GROUP_NODE_KIND) {
    throw new RangeError(`layer node ${afterNodeIndex} has no parent group`);
  }

  const parentGroup = document.groups[parentNode.itemIndex];
  const childRange = parentGroup?.childRange;
  if (!parentGroup || !childRange || !validRange(childRange, document.childIndices.length)) {
    throw new RangeError(`parent group for node ${afterNodeIndex} has no valid child range`);
  }

  const anchorPosition = document.childIndices.indexOf(afterNodeIndex, childRange.start);
  if (anchorPosition < childRange.start || anchorPosition >= childRange.start + childRange.len) {
    throw new RangeError(`node ${afterNodeIndex} is not an immediate child of its parent group`);
  }

  const nodeIndex = document.nodes.length;
  const layerIndex = document.layers.length;
  const layerName = nextStrokeName(document);
  const insertionPosition = anchorPosition + 1;

  const newNode = Object.assign(new LayerTreeNodeT(), {
    name: layerName,
    type: LAYER_NODE_KIND,
    itemIndex: layerIndex,
    parentIndex: parentNodeIndex,
  });
  const newLayer = Object.assign(new LayerT(), {
    name: layerName,
    type: LAYER_NODE_KIND,
    itemIndex: layerIndex,
    parentIndex: parentNodeIndex,
    frames: [],
    masks: [],
    opacity: 1,
    activeMaskIndex: NONE_INDEX,
    mimeType: MimeType.MIME_TYPE_APPLICATION_GPEN,
    renderBy: RenderBy.RENDER_BY_JS_UNSPECIFIED,
  });

  const childIndices = [
    ...document.childIndices.slice(0, insertionPosition),
    nodeIndex,
    ...document.childIndices.slice(insertionPosition),
  ];

  const groups = document.groups.map((group, groupIndex) => {
    const range = group.childRange;
    if (!range) return group;

    if (groupIndex === parentNode.itemIndex) {
      return cloneGroupWithRange(group, range.start, range.len + 1);
    }
    if (range.start >= insertionPosition) {
      return cloneGroupWithRange(group, range.start + 1, range.len);
    }
    return group;
  });

  return Object.assign(new GpenT(), document, {
    nodes: [...document.nodes, newNode],
    layers: [...document.layers, newLayer],
    groups,
    childIndices,
  });
}

/** Return a document with only the active node changed. */
export function setActiveNode(document: GpenT, nodeIndex: number): GpenT {
  return Object.assign(new GpenT(), document, { activeNodeIndex: nodeIndex });
}

/**
 * Ensure that the active layer is drawable, creating and selecting one above
 * the active non-drawable layer when necessary.
 */
export function ensureDrawableActiveLayer(document: GpenT): GpenT {
  const activeNode = document.nodes[document.activeNodeIndex];
  if (activeNode?.type === LAYER_NODE_KIND) {
    const activeLayer = document.layers[activeNode.itemIndex];
    if (activeLayer && isDrawableLayer(activeLayer)) return document;
  }

  const created = createDrawingLayer(document, {
    afterNodeIndex: document.activeNodeIndex,
  });
  return setActiveNode(created, created.nodes.length - 1);
}

function cloneGroupWithRange(group: LayerGroupT, start: number, len: number): LayerGroupT {
  return Object.assign(new LayerGroupT(), group, {
    childRange: new IndexRangeT(start, len),
  });
}

/**
 * Rename a node and its protocol payload (layer or group) together, so the
 * `nodes` and `layers`/`groups` tables never disagree about a name. Returns a
 * new document; the active node is not touched.
 */
export function renameNode(document: GpenT, nodeIndex: number, name: string): GpenT {
  const node = document.nodes[nodeIndex];
  if (!node) throw new RangeError(`cannot rename unknown node ${nodeIndex}`);

  const nodes = document.nodes.map((candidate, index) =>
    index === nodeIndex ? Object.assign(new LayerTreeNodeT(), candidate, { name }) : candidate,
  );
  if (node.type === LAYER_NODE_KIND) {
    const layers = document.layers.map((layer, index) =>
      index === node.itemIndex ? Object.assign(new LayerT(), layer, { name }) : layer,
    );
    return Object.assign(new GpenT(), document, { nodes, layers });
  }
  const groups = document.groups.map((group, index) =>
    index === node.itemIndex ? Object.assign(new LayerGroupT(), group, { name }) : group,
  );
  return Object.assign(new GpenT(), document, { nodes, groups });
}

/**
 * Apply structural moves to the adjacency model.
 *
 * The child vector is the only source of sibling order, so a move is: detach
 * the node from its parent's range (shrinking it and shifting every later
 * range back), then insert it into the destination range (growing it and
 * shifting every later range forward). The node's `parentIndex` is updated in
 * `nodes` and in its payload, which keeps `buildLayerTree` consistent with the
 * moved adjacency.
 *
 * Ops are applied in order and each op is validated against the document as it
 * is after the previous ones. Moving a node into its own subtree is rejected
 * with a `RangeError` — the UI must veto that target before calling.
 */
export function moveNodes(document: GpenT, ops: readonly MoveNodeOp[]): GpenT {
  let next = document;
  for (const op of ops) {
    if (!Number.isSafeInteger(op.nodeIndex) || !Number.isSafeInteger(op.parentNodeIndex))
      throw new RangeError(`invalid move: ${op.nodeIndex} -> ${op.parentNodeIndex}`);
    if (isInSubtree(next, op.nodeIndex, op.parentNodeIndex))
      throw new RangeError(`cannot move node ${op.nodeIndex} into its own subtree`);
    next = attachChild(
      detachChild(next, op.nodeIndex),
      op.nodeIndex,
      op.parentNodeIndex,
      op.beforeNodeIndex,
    );
  }
  return next;
}

/** Remove a node from its parent's range. */
function detachChild(document: GpenT, childNodeIndex: number): GpenT {
  const node = document.nodes[childNodeIndex];
  if (!node) throw new RangeError(`cannot move unknown node ${childNodeIndex}`);
  if (node.parentIndex === NONE_INDEX)
    throw new RangeError(`cannot move the root node ${childNodeIndex}`);

  const parentNodeIndex = node.parentIndex;
  const { groupIndex, start, len } = groupRange(document, parentNodeIndex);
  const position = document.childIndices.indexOf(childNodeIndex, start);
  if (position < start || position >= start + len)
    throw new RangeError(
      `node ${childNodeIndex} is not an immediate child of group ${parentNodeIndex}`,
    );

  const childIndices = [
    ...document.childIndices.slice(0, position),
    ...document.childIndices.slice(position + 1),
  ];
  const groups = document.groups.map((group, index) => {
    const range = group.childRange;
    if (!range) return group;
    if (index === groupIndex) return cloneGroupWithRange(group, start, len - 1);
    if (range.start > position) return cloneGroupWithRange(group, range.start - 1, range.len);
    return group;
  });
  return Object.assign(new GpenT(), document, { childIndices, groups });
}

/** Insert an already detached node into a destination group. */
function attachChild(
  document: GpenT,
  childNodeIndex: number,
  parentNodeIndex: number,
  beforeNodeIndex: number | undefined,
): GpenT {
  const node = document.nodes[childNodeIndex];
  if (!node) throw new RangeError(`cannot move unknown node ${childNodeIndex}`);

  const { groupIndex, start, len } = groupRange(document, parentNodeIndex);
  let position: number;
  if (beforeNodeIndex === undefined) {
    position = start + len;
  } else {
    position = document.childIndices.indexOf(beforeNodeIndex, start);
    if (position < start || position >= start + len)
      throw new RangeError(
        `node ${beforeNodeIndex} is not an immediate child of group ${parentNodeIndex}`,
      );
  }

  const childIndices = [
    ...document.childIndices.slice(0, position),
    childNodeIndex,
    ...document.childIndices.slice(position),
  ];
  const groups = document.groups.map((group, index) => {
    const range = group.childRange;
    let next = group;
    if (index === groupIndex) next = cloneGroupWithRange(next, start, len + 1);
    else if (range && range.start >= position)
      next = cloneGroupWithRange(next, range.start + 1, range.len);
    if (node.type === GROUP_NODE_KIND && index === node.itemIndex)
      next = Object.assign(new LayerGroupT(), next, { parentIndex: parentNodeIndex });
    return next;
  });
  const nodes = document.nodes.map((candidate, index) =>
    index === childNodeIndex
      ? Object.assign(new LayerTreeNodeT(), candidate, { parentIndex: parentNodeIndex })
      : candidate,
  );
  const layers =
    node.type === LAYER_NODE_KIND
      ? document.layers.map((layer, index) =>
          index === node.itemIndex
            ? Object.assign(new LayerT(), layer, { parentIndex: parentNodeIndex })
            : layer,
        )
      : document.layers;
  return Object.assign(new GpenT(), document, { nodes, layers, groups, childIndices });
}

/** Locate a group node's slice of the shared child vector. */
function groupRange(
  document: GpenT,
  groupNodeIndex: number,
): { groupIndex: number; start: number; len: number } {
  const node = document.nodes[groupNodeIndex];
  if (!node || node.type !== GROUP_NODE_KIND)
    throw new RangeError(`node ${groupNodeIndex} is not a group`);
  const group = document.groups[node.itemIndex];
  const range = group?.childRange;
  if (!group || !range || !validRange(range, document.childIndices.length))
    throw new RangeError(`group node ${groupNodeIndex} has no valid child range`);
  return { groupIndex: node.itemIndex, start: range.start, len: range.len };
}

/** True when `candidateNodeIndex` is `ancestorNodeIndex` or below it. */
function isInSubtree(
  document: GpenT,
  ancestorNodeIndex: number,
  candidateNodeIndex: number,
): boolean {
  let cursor = candidateNodeIndex;
  for (let guard = 0; guard <= document.nodes.length; guard += 1) {
    if (cursor === ancestorNodeIndex) return true;
    const node = document.nodes[cursor];
    if (!node || node.parentIndex === NONE_INDEX) return false;
    cursor = node.parentIndex;
  }
  // Malformed parent cycle: refuse the move instead of walking forever.
  return true;
}

function validRange(range: IndexRangeT, childIndicesLength: number): boolean {
  return (
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.len) &&
    range.start >= 0 &&
    range.len >= 0 &&
    range.start + range.len <= childIndicesLength
  );
}

function nextStrokeName(document: GpenT): string {
  let max = 0;
  for (const layer of document.layers) {
    const name = textValue(layer.name);
    const match = /^Stroke-(\d+)$/.exec(name);
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > max) max = number;
  }
  return `Stroke-${max + 1}`;
}

function textValue(value: string | Uint8Array | null): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}
