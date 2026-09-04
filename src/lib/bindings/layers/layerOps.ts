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

import { NONE_INDEX } from "../flatbuffers/constants";
import { isDrawableLayer } from "../flatbuffers/defaults";

export interface CreateDrawingLayerOptions {
  /** Insert the new layer immediately after this layer in its group. */
  afterNodeIndex?: number;
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
