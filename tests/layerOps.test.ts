import { describe, expect, test } from "bun:test";
import { MimeType, RenderBy } from "gpen-protocol/flatbuffers";

import { createDefaultGpen, isDrawableLayer } from "../src/lib/protocol/defaults";
import { NONE_INDEX } from "../src/lib/protocol/constants";
import {
  createDrawingLayer,
  ensureDrawableActiveLayer,
  setActiveNode,
} from "../src/lib/layers/layerOps";
import { buildLayerTree } from "../src/lib/layers/layerAdapter";

const URL = "https://example.com/x";

function expectLayerTreeStructure(document: ReturnType<typeof createDefaultGpen>): void {
  for (let nodeIndex = 0; nodeIndex < document.nodes.length; nodeIndex += 1) {
    const node = document.nodes[nodeIndex];
    if (node.parentIndex === NONE_INDEX) continue;

    const parent = document.nodes[node.parentIndex];
    expect(parent).toBeDefined();
    expect(parent.type).toBe(1);
    const group = document.groups[parent.itemIndex];
    expect(group).toBeDefined();
    expect(group.childRange).not.toBeNull();
    const range = group.childRange!;
    expect(document.childIndices.slice(range.start, range.start + range.len)).toContain(nodeIndex);

    if (node.type === 0) {
      const layer = document.layers[node.itemIndex];
      expect(layer).toBeDefined();
      expect(layer.itemIndex).toBe(node.itemIndex);
      expect(layer.parentIndex).toBe(node.parentIndex);
    }
  }
}

describe("layer operations", () => {
  test("ensures a drawable layer above the active web layer", () => {
    const document = createDefaultGpen(URL);
    const result = ensureDrawableActiveLayer(document);
    const newNodeIndex = result.nodes.length - 1;
    const newNode = result.nodes[newNodeIndex];
    const newLayer = result.layers[newNode.itemIndex];

    expect(document.activeNodeIndex).toBe(1);
    expect(result.activeNodeIndex).toBe(newNodeIndex);
    expect(newLayer.name).toBe("Stroke-1");
    expect(newLayer.mimeType).toBe(MimeType.MIME_TYPE_APPLICATION_GPEN);
    expect(newLayer.renderBy).toBe(RenderBy.RENDER_BY_JS_UNSPECIFIED);
    expect(isDrawableLayer(newLayer)).toBe(true);
    // The adjacency vector is the sibling order; a later sibling is above its
    // preceding layer in the document draw order.
    expect(result.childIndices).toEqual([1, newNodeIndex]);
    expect(buildLayerTree(result).root?.children.map((node) => node.name)).toEqual([
      URL,
      "Stroke-1",
    ]);
    expectLayerTreeStructure(result);
  });

  test("increments the Stroke name when ensuring again after reselecting the web layer", () => {
    const first = ensureDrawableActiveLayer(createDefaultGpen(URL));
    const second = ensureDrawableActiveLayer(setActiveNode(first, 1));
    const newNodeIndex = second.nodes.length - 1;

    expect(second.nodes[newNodeIndex].name).toBe("Stroke-2");
    expect(second.activeNodeIndex).toBe(newNodeIndex);
    expect(second.childIndices).toEqual([1, newNodeIndex, 2]);
  });

  test("keeps creation and selection independent", () => {
    const document = createDefaultGpen(URL);
    const created = createDrawingLayer(document);

    expect(created.activeNodeIndex).toBe(document.activeNodeIndex);
    expect(created.nodes).toHaveLength(document.nodes.length + 1);
    expect(created.layers).toHaveLength(document.layers.length + 1);

    const selected = setActiveNode(document, 0);
    expect(selected.activeNodeIndex).toBe(0);
    expect(selected.nodes).toHaveLength(document.nodes.length);
    expect(selected.layers).toHaveLength(document.layers.length);
  });

  test("updates node, payload, group range, and adjacency indexes together", () => {
    const document = createDefaultGpen(URL);
    const result = createDrawingLayer(document);
    const newNodeIndex = result.nodes.length - 1;
    const newNode = result.nodes[newNodeIndex];
    const rootGroup = result.groups[0];

    expect(newNode.parentIndex).toBe(0);
    expect(newNode.itemIndex).toBe(result.layers.length - 1);
    expect(rootGroup.childRange).toMatchObject({ start: 0, len: 2 });
    expect(result.childIndices.slice(0, 2)).toEqual([1, newNodeIndex]);
    expectLayerTreeStructure(result);
  });
});
