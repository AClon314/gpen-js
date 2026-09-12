import { describe, expect, test } from "bun:test";
import { MimeType, RenderBy } from "gpen-protocol/flatbuffers";

import { createDefaultGpen, isDrawableLayer } from "../src/lib/protocol/defaults";
import { NONE_INDEX } from "../src/lib/protocol/constants";
import { buildLayerTree } from "../src/lib/layers/layerAdapter";

const URL = "https://example.com/docs";

describe("createDefaultGpen", () => {
  test("creates a selected, non-drawable web layer under the root group", () => {
    const document = createDefaultGpen(URL);
    const rootNode = document.nodes[0];
    const webPageNode = document.nodes[1];
    const webPageLayer = document.layers[0];
    const rootGroup = document.groups[0];

    expect(document.drawings).toEqual([]);
    expect(document.nodes).toHaveLength(2);
    expect(document.layers).toHaveLength(1);
    expect(document.groups).toHaveLength(1);
    expect(document.childIndices).toEqual([1]);

    expect(rootNode).toMatchObject({
      type: 1,
      itemIndex: 0,
      parentIndex: NONE_INDEX,
    });
    expect(webPageNode).toMatchObject({
      type: 0,
      itemIndex: 0,
      parentIndex: 0,
      name: URL,
    });
    expect(rootGroup).toMatchObject({
      type: 1,
      itemIndex: 0,
      parentIndex: NONE_INDEX,
    });
    expect(rootGroup.childRange).toMatchObject({ start: 0, len: 1 });

    expect(webPageLayer.name).toBe(URL);
    expect(webPageLayer.mimeType).toBe(MimeType.MIME_TYPE_TEXT_HTML_UNSPECIFIED);
    expect(webPageLayer.renderBy).toBe(RenderBy.RENDER_BY_JS_UNSPECIFIED);
    expect(webPageLayer.frames).toEqual([]);
    expect(webPageLayer.opacity).toBe(1);
    expect(webPageLayer.activeMaskIndex).toBe(NONE_INDEX);
    expect(document.activeNodeIndex).toBe(1);
    expect(isDrawableLayer(webPageLayer)).toBe(false);

    const tree = buildLayerTree(document);
    expect(tree.root?.node_index).toBe(0);
    expect(tree.root?.children).toHaveLength(1);
    expect(tree.root?.children[0].node_index).toBe(1);
    expect(tree.active_node?.node_index).toBe(1);
  });
});
