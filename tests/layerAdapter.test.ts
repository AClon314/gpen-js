import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  DrawingSlotT,
  GpenT,
  IndexRangeT,
  LayerFlagsT,
  LayerGroupT,
  LayerT,
  LayerTreeNodeT,
} from "gpen-protocol/flatbuffers";

import { decodeGpen } from "../src/lib/bindings/flatbuffers/codec";
import { NONE_INDEX } from "../src/lib/bindings/flatbuffers/constants";
import { buildLayerTree } from "../src/lib/bindings/layers/layerAdapter";
import { LAYER_NODE_GROUP, LAYER_NODE_LAYER } from "../src/lib/bindings/layers/types";
import type { UiLayerGroupNode, UiLayerNode } from "../src/lib/bindings/layers/types";

// tests/ -> ../../gpen-protocol/fixtures/gpen/v1 (same layout as
// flatbuffers-fixtures.test.ts; independent of the process CWD).
const FIXTURES_DIR = join(import.meta.dir, "../../gpen-protocol/fixtures/gpen/v1");

/**
 * Build a generated `*T` object from a partial literal. The generated object
 * API uses constructor parameter properties, so plain `Object.assign` over a
 * `new T()` keeps every default and avoids unreadable positional arguments.
 */
function make<T>(ctor: new () => T, init: Record<string, unknown>): T {
  const target = new ctor();
  for (const [key, value] of Object.entries(init)) {
    (target as Record<string, unknown>)[key] = value;
  }
  return target;
}

function loadFixture(name: string): Uint8Array {
  return readFileSync(`${FIXTURES_DIR}/${name}`);
}

function layerNode(
  name: string,
  itemIndex: number,
  parentIndex: number,
  flags?: LayerFlagsT | null,
): LayerTreeNodeT {
  return make(LayerTreeNodeT, {
    name,
    type: LAYER_NODE_LAYER,
    itemIndex,
    parentIndex,
    color: null,
    flags: flags ?? null,
  });
}
function groupNode(name: string, itemIndex: number, parentIndex: number): LayerTreeNodeT {
  return make(LayerTreeNodeT, {
    name,
    type: LAYER_NODE_GROUP,
    itemIndex,
    parentIndex,
    color: null,
    flags: null,
  });
}

function layerPayload(
  name: string,
  itemIndex: number,
  parentIndex: number,
  flags?: LayerFlagsT | null,
): LayerT {
  return make(LayerT, {
    name,
    type: LAYER_NODE_LAYER,
    itemIndex,
    parentIndex,
    color: null,
    flags: flags ?? null,
    frames: [],
    masks: [],
    blendMode: 0,
    opacity: 1,
    parent: null,
    transform: null,
    parentInverse: null,
    viewLayerName: "",
    activeMaskIndex: NONE_INDEX,
    passIndex: 0,
    tintColor: null,
    radiusOffset: 0,
  });
}

function groupPayload(
  name: string,
  itemIndex: number,
  parentIndex: number,
  childRange: { start: number; len: number },
  colorTag: number,
): LayerGroupT {
  return make(LayerGroupT, {
    name,
    type: LAYER_NODE_GROUP,
    itemIndex,
    parentIndex,
    color: null,
    flags: null,
    childRange: make(IndexRangeT, childRange),
    colorTag,
  });
}

/**
 * Nested two-level group document. The `nodes` array order is deliberately
 * NOT the sibling order: Root's children in `childIndices` are [G2, G1]
 * while `nodes` lists G1 before G2, and layer A (node 2) sits between them.
 * Only the adjacency vector may define the tree order.
 */
function nestedGroupDocument(): GpenT {
  const aFlags = make(LayerFlagsT, {
    hidden: true,
    locked: false,
    selected: true,
    muted: false,
    useLights: false,
    hideOnionSkin: false,
    expanded: true,
    hideMasks: false,
    disableMasksInViewlayer: false,
    ignoreLockedMaterials: false,
  });
  return make(GpenT, {
    drawings: [],
    nodes: [
      groupNode("Root", 0, NONE_INDEX), // node 0
      groupNode("G1", 1, 0), // node 1
      layerNode("A", 0, 1, aFlags), // node 2
      groupNode("G2", 2, 0), // node 3
      layerNode("B", 1, 3), // node 4
    ],
    layers: [layerPayload("A", 0, 1, aFlags), layerPayload("B", 1, 3)],
    groups: [
      groupPayload("Root", 0, NONE_INDEX, { start: 0, len: 2 }, 0),
      groupPayload("G1", 1, 0, { start: 2, len: 1 }, 1),
      groupPayload("G2", 2, 0, { start: 3, len: 1 }, 2),
    ],
    materials: [],
    activeNodeIndex: 2, // layer A
    onionSkinningSettings: null,
    flags: null,
    // Root: [node 3 (G2), node 1 (G1)]; G1: [node 2 (A)]; G2: [node 4 (B)]
    childIndices: [3, 1, 2, 4],
  });
}

describe("buildLayerTree from fixture full.bin", () => {
  const document = decodeGpen(loadFixture("full.bin"));
  const tree = buildLayerTree(document);

  test("root group and immediate child order", () => {
    expect(tree.root).not.toBeNull();
    expect(tree.root!.kind).toBe(LAYER_NODE_GROUP);
    expect(tree.root!.name).toBe("Root");
    expect(tree.root!.item_index).toBe(0);
    expect(tree.root!.parent_index).toBe(NONE_INDEX);
    expect(tree.root!.children).toHaveLength(1);
  });

  test("layer node payload fields are preserved", () => {
    const ink = tree.root!.children[0] as UiLayerNode;
    expect(ink.kind).toBe(LAYER_NODE_LAYER);
    expect(ink.name).toBe("Ink");
    expect(ink.item_index).toBe(0);
    expect(ink.opacity).toBe(1);
    expect(ink.blend_mode).toBe(0);
    expect(ink.layer.frames).toHaveLength(1);
    expect(ink.parent_index).toBe(tree.root!.node_index);
    // The full.bin fixture omits the flags table, so it maps to null.
    expect(ink.flags).toBeNull();
  });

  test("active node resolution", () => {
    expect(tree.active_node).not.toBeNull();
    expect(tree.active_node!.name).toBe("Ink");
    expect(tree.active_node!.active).toBe(true);
    expect(tree.root!.active).toBe(false);
  });

  test("flattenedDrawOrder follows the tree pre-order", () => {
    expect(tree.flattenedDrawOrder().map((node) => node.name)).toEqual(["Ink"]);
  });
});

describe("buildLayerTree with nested groups", () => {
  const tree = buildLayerTree(nestedGroupDocument());

  test("sibling order comes from childIndices, not nodes order", () => {
    expect(tree.root!.children.map((node) => node.name)).toEqual(["G2", "G1"]);
    const g2 = tree.root!.children[0] as UiLayerGroupNode;
    const g1 = tree.root!.children[1] as UiLayerGroupNode;
    expect(g2.children.map((node) => node.name)).toEqual(["B"]);
    expect(g1.children.map((node) => node.name)).toEqual(["A"]);
    expect(g2.color_tag).toBe(2);
    expect(g1.color_tag).toBe(1);
  });

  test("nested flags and parent_index are mapped", () => {
    const a = tree.root!.children[1].children[0] as UiLayerNode;
    expect(a.flags!.hidden).toBe(true);
    expect(a.flags!.selected).toBe(true);
    expect(a.flags!.expanded).toBe(true);
    expect(a.flags!.locked).toBe(false);
    expect(a.parent_index).toBe(tree.root!.children[1].node_index);
  });

  test("active node is found inside a nested group", () => {
    expect(tree.active_node).not.toBeNull();
    expect(tree.active_node!.name).toBe("A");
    expect(tree.active_node!.active).toBe(true);
    expect(tree.root!.children[1].children[0].active).toBe(true);
  });

  test("flattenedDrawOrder is the pre-order of the adjacency tree", () => {
    // Root -> G2 -> B -> G1 -> A (adjacency order, not nodes order).
    expect(tree.flattenedDrawOrder().map((node) => node.name)).toEqual(["B", "A"]);
  });
});

describe("buildLayerTree with structurally parsed input", () => {
  test("DrawingSlot with both payloads empty does not affect tree mapping", () => {
    const invalid = nestedGroupDocument();
    invalid.drawings = [make(DrawingSlotT, { drawing: null, reference: null })];
    expect(buildLayerTree(invalid).root?.name).toBe("Root");
  });

  test("fixture invalid-drawing-slot-empty.bin remains structurally decodable", () => {
    const document = decodeGpen(loadFixture("invalid-drawing-slot-empty.bin"));
    expect(document.drawings[0].drawing).toBeNull();
    expect(document.drawings[0].reference).toBeNull();
  });

  test("empty document yields an empty tree", () => {
    const empty = make(GpenT, {
      drawings: [],
      nodes: [],
      layers: [],
      groups: [],
      materials: [],
      activeNodeIndex: NONE_INDEX,
      onionSkinningSettings: null,
      flags: null,
      childIndices: [],
    });
    const tree = buildLayerTree(empty);
    expect(tree.root).toBeNull();
    expect(tree.active_node).toBeNull();
    expect(tree.flattenedDrawOrder()).toEqual([]);
  });
});
