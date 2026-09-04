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

import { NONE_INDEX } from "./constants";

const ROOT_NODE_INDEX = 0;
const WEB_PAGE_NODE_INDEX = 1;

/**
 * Create the initial document shown for a web page.
 *
 * `mimeType=text/html` identifies a web layer that cannot be drawn directly;
 * drawable layers use `application/gpen` instead.
 */
export function createDefaultGpen(url: string): GpenT {
  const rootNode = Object.assign(new LayerTreeNodeT(), {
    name: "Root",
    type: LayerTreeNodeKind.LAYER_TREE_NODE_KIND_GROUP,
    itemIndex: 0,
    parentIndex: NONE_INDEX,
  });

  const webPageNode = Object.assign(new LayerTreeNodeT(), {
    name: url,
    type: LayerTreeNodeKind.LAYER_TREE_NODE_KIND_LAYER_UNSPECIFIED,
    itemIndex: 0,
    parentIndex: ROOT_NODE_INDEX,
  });

  const webPageLayer = Object.assign(new LayerT(), {
    name: url,
    type: LayerTreeNodeKind.LAYER_TREE_NODE_KIND_LAYER_UNSPECIFIED,
    itemIndex: 0,
    parentIndex: ROOT_NODE_INDEX,
    frames: [],
    opacity: 1,
    activeMaskIndex: NONE_INDEX,
    mimeType: MimeType.MIME_TYPE_TEXT_HTML_UNSPECIFIED,
    renderBy: RenderBy.RENDER_BY_JS_UNSPECIFIED,
  });

  const rootGroup = Object.assign(new LayerGroupT(), {
    name: "Root",
    type: LayerTreeNodeKind.LAYER_TREE_NODE_KIND_GROUP,
    itemIndex: 0,
    parentIndex: NONE_INDEX,
    childRange: new IndexRangeT(0, 1),
  });

  return Object.assign(new GpenT(), {
    drawings: [],
    nodes: [rootNode, webPageNode],
    layers: [webPageLayer],
    groups: [rootGroup],
    activeNodeIndex: WEB_PAGE_NODE_INDEX,
    childIndices: [WEB_PAGE_NODE_INDEX],
  });
}

export function isDrawableLayer(layer: LayerT): boolean {
  return layer.mimeType !== MimeType.MIME_TYPE_TEXT_HTML_UNSPECIFIED;
}
