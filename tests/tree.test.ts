import { describe, expect, test } from "bun:test";
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

import { NONE_INDEX } from "../src/lib/protocol/constants";
import { buildLayerTree } from "../src/lib/layers/layerAdapter";
import { moveNodes, renameNode } from "../src/lib/layers/layerOps";
import { LAYER_NODE_GROUP, LAYER_NODE_LAYER } from "../src/lib/layers/types";
import type { UiLayerGroupNode, UiLayerNode, UiLayerTreeNode } from "../src/lib/layers/types";
import {
  applyDrop,
  dropTargetFromPoint,
  flattenRows,
  nextFocusKey,
  rowByKey,
  rowIndex,
  searchRows,
  selectionAfter,
  typeaheadKey,
  visibleRows,
  type DropTarget,
  type TreeKey,
} from "../src/lib/layers/tree";

/* ------------------------------------------------------------------ fixture */

/**
 * Hand-built UI tree (no protocol document needed for the pure functions):
 *
 *   Root(0)          level 1
 *   ├── G1(1)        level 2
 *   │   ├── Alpha(2) level 3
 *   │   └── Beta(3)  level 3
 *   └── Gamma(4)     level 2
 */
function makeGroup(
  key: number,
  name: string,
  parentKey: number | null,
  children: UiLayerTreeNode[],
): UiLayerGroupNode {
  const parent = parentKey ?? NONE_INDEX;
  return {
    node_index: key,
    name,
    kind: LAYER_NODE_GROUP,
    flags: null,
    color: null,
    parent_index: parent,
    active: false,
    children,
    item_index: key,
    color_tag: 0,
    group: Object.assign(new LayerGroupT(), { name, itemIndex: key, parentIndex: parent }),
  };
}

function makeLayer(key: number, name: string, parentKey: number | null): UiLayerNode {
  const parent = parentKey ?? NONE_INDEX;
  return {
    node_index: key,
    name,
    kind: LAYER_NODE_LAYER,
    flags: null,
    color: null,
    parent_index: parent,
    active: false,
    children: [],
    item_index: key,
    opacity: 1,
    blend_mode: 0,
    layer: Object.assign(new LayerT(), { name, itemIndex: key, parentIndex: parent }),
  };
}

function fixture(): UiLayerTreeNode {
  return makeGroup(0, "Root", null, [
    makeGroup(1, "G1", 0, [makeLayer(2, "Alpha", 1), makeLayer(3, "Beta", 1)]),
    makeLayer(4, "Gamma", 0),
  ]);
}

const ALL_EXPANDED: ReadonlySet<TreeKey> = new Set([0, 1]);
const keys = (rows: { key: TreeKey }[]): TreeKey[] => rows.map((row) => row.key);

/* ---------------------------------------------------------------- flattening */

describe("flattenRows / visibleRows", () => {
  test("pre-order traversal with 1-based levels and parent keys", () => {
    const rows = flattenRows(fixture());
    expect(keys(rows)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.map((row) => row.textValue)).toEqual(["Root", "G1", "Alpha", "Beta", "Gamma"]);
    expect(rows.map((row) => row.level)).toEqual([1, 2, 3, 3, 2]);
    expect(rows.map((row) => row.parentKey)).toEqual([null, 0, 1, 1, 0]);
    expect(rows.map((row) => row.hasChildren)).toEqual([true, true, false, false, false]);
    expect(rows[2].data.name).toBe("Alpha");
  });

  test("null root yields no rows", () => {
    expect(flattenRows(null)).toEqual([]);
    expect(visibleRows(null, ALL_EXPANDED)).toEqual([]);
  });

  test("collapsed subtrees drop out of visibleRows", () => {
    expect(keys(visibleRows(fixture(), ALL_EXPANDED))).toEqual([0, 1, 2, 3, 4]);
    expect(keys(visibleRows(fixture(), new Set([0])))).toEqual([0, 1, 4]);
    expect(keys(visibleRows(fixture(), new Set([0, 1])))).toEqual([0, 1, 2, 3, 4]);
    expect(keys(visibleRows(fixture(), new Set()))).toEqual([0]);
    // Expanding a child does not expand the collapsed root.
    expect(keys(visibleRows(fixture(), new Set([1])))).toEqual([0]);
  });

  test("rowIndex / rowByKey only find visible rows", () => {
    const rows = visibleRows(fixture(), new Set([0]));
    expect(rowIndex(rows, 4)).toBe(2);
    expect(rowIndex(rows, 2)).toBe(-1);
    expect(rowByKey(rows, 4)?.textValue).toBe("Gamma");
    expect(rowByKey(rows, 2)).toBeUndefined();
    expect(rowByKey(flattenRows(fixture()), 2)?.textValue).toBe("Alpha");
  });
});

/* ------------------------------------------------------------------ keyboard */

describe("nextFocusKey", () => {
  const rows = flattenRows(fixture());
  const collapsed = visibleRows(fixture(), new Set([0]));

  test("vertical and home/end movement", () => {
    expect(nextFocusKey(rows, 2, "up")).toBe(1);
    expect(nextFocusKey(rows, 2, "down")).toBe(3);
    expect(nextFocusKey(rows, 0, "home")).toBe(0);
    expect(nextFocusKey(rows, 2, "end")).toBe(4);
  });

  test("boundaries do not wrap", () => {
    expect(nextFocusKey(rows, 0, "up")).toBe(0);
    expect(nextFocusKey(rows, 4, "down")).toBe(4);
  });

  test("right enters the first child or signals expand", () => {
    expect(nextFocusKey(rows, 1, "right")).toBe(2);
    expect(nextFocusKey(rows, 2, "right")).toBe(2); // leaf: no-op
    expect(nextFocusKey(collapsed, 1, "right")).toBe(1); // collapsed: expand
  });

  test("left goes to the parent or signals collapse", () => {
    expect(nextFocusKey(rows, 2, "left")).toBe(1);
    expect(nextFocusKey(rows, 1, "left")).toBe(1); // expanded: collapse
    expect(nextFocusKey(collapsed, 1, "left")).toBe(0);
    expect(nextFocusKey(rows, 0, "left")).toBe(0); // root has no parent
  });

  test("no current row enters at the end or the start", () => {
    expect(nextFocusKey(rows, undefined, "end")).toBe(4);
    expect(nextFocusKey(rows, undefined, "up")).toBe(4);
    expect(nextFocusKey(rows, undefined, "down")).toBe(0);
    expect(nextFocusKey(rows, 99, "down")).toBe(0);
    expect(nextFocusKey([], 0, "down")).toBeUndefined();
  });
});

/* ----------------------------------------------------------------- selection */

describe("selectionAfter", () => {
  const rows = flattenRows(fixture());
  const none = { shift: false, ctrl: false };

  test("plain click replaces the selection", () => {
    expect([...selectionAfter(rows, new Set([1, 4]), 2, none)]).toEqual([2]);
  });

  test("ctrl toggles, including emptying the selection", () => {
    expect([...selectionAfter(rows, new Set([1]), 2, { shift: false, ctrl: true })]).toEqual([
      1, 2,
    ]);
    expect([...selectionAfter(rows, new Set([1, 2]), 2, { shift: false, ctrl: true })]).toEqual([
      1,
    ]);
    expect([...selectionAfter(rows, new Set([1]), 1, { shift: false, ctrl: true })]).toEqual([]);
  });

  test("shift selects the visible range in both directions", () => {
    expect([...selectionAfter(rows, new Set([2]), 4, { shift: true, ctrl: false })]).toEqual([
      2, 3, 4,
    ]);
    expect([...selectionAfter(rows, new Set([4]), 2, { shift: true, ctrl: false })]).toEqual([
      2, 3, 4,
    ]);
    expect([...selectionAfter(rows, new Set([0]), 0, { shift: true, ctrl: false })]).toEqual([0]);
  });

  test("shift only covers visible rows", () => {
    const collapsed = visibleRows(fixture(), new Set([0]));
    expect([...selectionAfter(collapsed, new Set([1]), 4, { shift: true, ctrl: false })]).toEqual([
      1, 4,
    ]);
  });

  test("shift without a visible anchor falls back to a single selection", () => {
    expect([...selectionAfter(rows, new Set([99]), 2, { shift: true, ctrl: false })]).toEqual([2]);
  });

  test("shift+ctrl toggles (ctrl wins)", () => {
    expect([...selectionAfter(rows, new Set([1, 2]), 2, { shift: true, ctrl: true })]).toEqual([1]);
  });
});

/* ---------------------------------------------------- typeahead and search */

describe("typeaheadKey", () => {
  const rows = flattenRows(fixture());

  test("case-insensitive prefix match", () => {
    expect(typeaheadKey(rows, undefined, "ga")).toBe(4);
    expect(typeaheadKey(rows, undefined, "BETA")).toBe(3);
  });

  test("wraps around and skips the current row", () => {
    expect(typeaheadKey(rows, 4, "a")).toBe(2);
    expect(typeaheadKey(rows, 2, "r")).toBe(0);
  });

  test("no match / empty query", () => {
    expect(typeaheadKey(rows, 0, "zz")).toBeUndefined();
    expect(typeaheadKey(rows, 0, "")).toBeUndefined();
    expect(typeaheadKey([], 0, "a")).toBeUndefined();
  });
});

describe("searchRows", () => {
  const rows = flattenRows(fixture());

  test("case-insensitive substring match", () => {
    expect(keys(searchRows(rows, "a"))).toEqual([2, 3, 4]);
    expect(keys(searchRows(rows, "G1"))).toEqual([1]);
    expect(keys(searchRows(rows, "mm"))).toEqual([4]);
  });

  test("empty query matches nothing", () => {
    expect(searchRows(rows, "")).toEqual([]);
    expect(searchRows(rows, "   ")).toEqual([]);
  });
});

/* ---------------------------------------------------------------- drop target */

describe("dropTargetFromPoint", () => {
  const rows = flattenRows(fixture());
  const layout = { rowHeight: 20, indent: 10, scrollTop: 0 };
  const all = (): boolean => true;

  test("25% bands resolve before / on / after", () => {
    expect(dropTargetFromPoint(rows, { x: 100, y: 2 }, layout, all)).toEqual({
      type: "item",
      key: 0,
      position: "on", // root has no "before" slot
    });
    expect(dropTargetFromPoint(rows, { x: 100, y: 8 }, layout, all)).toEqual({
      type: "item",
      key: 0,
      position: "on",
    });
    expect(dropTargetFromPoint(rows, { x: 100, y: 18 }, layout, all)).toEqual({
      type: "item",
      key: 0,
      position: "after",
    });
  });

  test("a leaf cannot nest, so its middle band is after", () => {
    // Row 2 (Alpha) occupies y 40..60; middle band is "on" for a group only.
    expect(dropTargetFromPoint(rows, { x: 100, y: 50 }, layout, all)).toEqual({
      type: "item",
      key: 2,
      position: "after",
    });
    expect(dropTargetFromPoint(rows, { x: 100, y: 41 }, layout, all)).toEqual({
      type: "item",
      key: 2,
      position: "before",
    });
  });

  test("the indent gutter of a group resolves to a sibling insert", () => {
    // G1 is level 2: x < (2-1)*10 = 10 is left of its own indent.
    expect(dropTargetFromPoint(rows, { x: 5, y: 30 }, layout, all)).toEqual({
      type: "item",
      key: 1,
      position: "after",
    });
    expect(dropTargetFromPoint(rows, { x: 20, y: 30 }, layout, all)).toEqual({
      type: "item",
      key: 1,
      position: "on",
    });
  });

  test("scrollTop is applied to the point", () => {
    expect(dropTargetFromPoint(rows, { x: 100, y: 5 }, { ...layout, scrollTop: 20 }, all)).toEqual({
      type: "item",
      key: 1,
      position: "on",
    });
  });

  test("below the list is a root drop, above it is nothing", () => {
    expect(dropTargetFromPoint(rows, { x: 100, y: 200 }, layout, all)).toEqual({ type: "root" });
    expect(dropTargetFromPoint(rows, { x: 100, y: -1 }, layout, all)).toBeNull();
    expect(dropTargetFromPoint([], { x: 100, y: 10 }, layout, all)).toBeNull();
  });

  test("isValid vetoes the resolved target", () => {
    const veto = (target: DropTarget): boolean => target.type !== "root";
    expect(dropTargetFromPoint(rows, { x: 100, y: 200 }, layout, veto)).toBeNull();
    expect(
      dropTargetFromPoint(
        rows,
        { x: 100, y: 30 },
        layout,
        (target) => !(target.type === "item" && target.key === 1),
      ),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ drop ops */

describe("applyDrop", () => {
  const tree = fixture();

  test("before/after insert as siblings, on nests", () => {
    expect(applyDrop(tree, [2], { type: "item", key: 4, position: "before" })).toEqual([
      { kind: "move", key: 2, parentKey: 0, beforeKey: 4 },
    ]);
    expect(applyDrop(tree, [4], { type: "item", key: 2, position: "before" })).toEqual([
      { kind: "move", key: 4, parentKey: 1, beforeKey: 2 },
    ]);
    expect(applyDrop(tree, [4], { type: "item", key: 1, position: "on" })).toEqual([
      { kind: "move", key: 4, parentKey: 1 },
    ]);
    // "on" a group the node already ends is a no-op, not an op that moves nothing.
    expect(applyDrop(tree, [3], { type: "item", key: 1, position: "on" })).toEqual([]);
    // "after" the last child of a group appends to it.
    expect(applyDrop(tree, [4], { type: "item", key: 3, position: "after" })).toEqual([
      { kind: "move", key: 4, parentKey: 1 },
    ]);
  });

  test("root target appends to the root group", () => {
    expect(applyDrop(tree, [3], { type: "root" })).toEqual([
      { kind: "move", key: 3, parentKey: 0 },
    ]);
  });

  test("multiple keys keep their order", () => {
    expect(applyDrop(tree, [2, 3], { type: "item", key: 4, position: "before" })).toEqual([
      { kind: "move", key: 2, parentKey: 0, beforeKey: 4 },
      { kind: "move", key: 3, parentKey: 0, beforeKey: 4 },
    ]);
  });

  test("self, descendant and no-op moves emit nothing", () => {
    // into its own subtree (itself, and its child Alpha)
    expect(applyDrop(tree, [1], { type: "item", key: 1, position: "on" })).toEqual([]);
    expect(applyDrop(tree, [1], { type: "item", key: 2, position: "before" })).toEqual([]);
    // already before Beta / already appended to the root
    expect(applyDrop(tree, [2], { type: "item", key: 2, position: "after" })).toEqual([]);
    expect(applyDrop(tree, [4], { type: "root" })).toEqual([]);
    // unknown keys and unknown targets are ignored
    expect(applyDrop(tree, [99], { type: "root" })).toEqual([]);
    expect(applyDrop(tree, [2], { type: "item", key: 99, position: "on" })).toEqual([]);
  });
});

/* ------------------------------------------------- layer document operations */

const LAYER = LayerTreeNodeKind.LAYER_TREE_NODE_KIND_LAYER_UNSPECIFIED;

/**
 * Protocol document mirroring the UI fixture:
 * Root -> [G1 -> [Alpha, Beta], Gamma].
 */
function nestedDocument(): GpenT {
  const node = (
    name: string,
    type: number,
    itemIndex: number,
    parentIndex: number,
  ): LayerTreeNodeT => Object.assign(new LayerTreeNodeT(), { name, type, itemIndex, parentIndex });
  const layer = (name: string, itemIndex: number, parentIndex: number): LayerT =>
    Object.assign(new LayerT(), {
      name,
      type: LAYER,
      itemIndex,
      parentIndex,
      frames: [],
      masks: [],
      opacity: 1,
      activeMaskIndex: NONE_INDEX,
      mimeType: MimeType.MIME_TYPE_APPLICATION_GPEN,
      renderBy: RenderBy.RENDER_BY_JS_UNSPECIFIED,
    });
  const group = (
    name: string,
    itemIndex: number,
    parentIndex: number,
    childRange: { start: number; len: number },
  ): LayerGroupT =>
    Object.assign(new LayerGroupT(), {
      name,
      type: LAYER_NODE_GROUP,
      itemIndex,
      parentIndex,
      childRange: Object.assign(new IndexRangeT(), childRange),
    });

  return Object.assign(new GpenT(), {
    drawings: [],
    nodes: [
      node("Root", LAYER_NODE_GROUP, 0, NONE_INDEX),
      node("G1", LAYER_NODE_GROUP, 1, 0),
      node("Alpha", LAYER, 0, 1),
      node("Beta", LAYER, 1, 1),
      node("Gamma", LAYER, 2, 0),
    ],
    layers: [layer("Alpha", 0, 1), layer("Beta", 1, 1), layer("Gamma", 2, 0)],
    groups: [
      group("Root", 0, NONE_INDEX, { start: 0, len: 2 }),
      group("G1", 1, 0, { start: 2, len: 2 }),
    ],
    materials: [],
    activeNodeIndex: 2,
    onionSkinningSettings: null,
    flags: null,
    // Root children: [G1, Gamma]; G1 children: [Alpha, Beta]
    childIndices: [1, 4, 2, 3],
  });
}

describe("renameNode", () => {
  test("renames the node and its payload together", () => {
    const document = nestedDocument();
    const renamed = renameNode(document, 2, "Alpha renamed");
    const tree = buildLayerTree(renamed);

    expect(renamed.nodes[2].name).toBe("Alpha renamed");
    expect(renamed.layers[0].name).toBe("Alpha renamed");
    expect(document.nodes[2].name).toBe("Alpha");
    expect(tree.root?.children[0].children[0].name).toBe("Alpha renamed");
  });

  test("renames groups too", () => {
    const renamed = renameNode(nestedDocument(), 1, "Group renamed");
    expect(renamed.groups[1].name).toBe("Group renamed");
    expect(buildLayerTree(renamed).root?.children[0].name).toBe("Group renamed");
  });

  test("throws for an unknown node", () => {
    expect(() => renameNode(nestedDocument(), 99, "nope")).toThrow(RangeError);
  });
});

describe("moveNodes", () => {
  test("reparents a node to the end of the destination group", () => {
    const document = nestedDocument();
    const moved = moveNodes(document, [{ nodeIndex: 4, parentNodeIndex: 1 }]);
    const tree = buildLayerTree(moved);

    expect(moved.nodes[4].parentIndex).toBe(1);
    expect(moved.layers[2].parentIndex).toBe(1);
    expect(moved.groups[0].childRange).toMatchObject({ start: 0, len: 1 });
    expect(moved.groups[1].childRange).toMatchObject({ start: 1, len: 3 });
    expect(moved.childIndices).toEqual([1, 2, 3, 4]);
    expect(tree.root?.children.map((child) => child.name)).toEqual(["G1"]);
    expect(tree.root?.children[0].children.map((child) => child.name)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    // The input document is untouched.
    expect(document.childIndices).toEqual([1, 4, 2, 3]);
    expect(document.nodes[4].parentIndex).toBe(0);
  });

  test("reorders siblings before an anchor", () => {
    const moved = moveNodes(nestedDocument(), [
      { nodeIndex: 4, parentNodeIndex: 0, beforeNodeIndex: 1 },
    ]);
    const tree = buildLayerTree(moved);

    expect(moved.childIndices).toEqual([4, 1, 2, 3]);
    expect(tree.root?.children.map((child) => child.name)).toEqual(["Gamma", "G1"]);
  });

  test("applies a batch in order", () => {
    const moved = moveNodes(nestedDocument(), [
      { nodeIndex: 2, parentNodeIndex: 0 },
      { nodeIndex: 3, parentNodeIndex: 0, beforeNodeIndex: 2 },
    ]);
    expect(buildLayerTree(moved).root?.children.map((child) => child.name)).toEqual([
      "G1",
      "Gamma",
      "Beta",
      "Alpha",
    ]);
  });

  test("refuses to move a node into its own subtree", () => {
    expect(() => moveNodes(nestedDocument(), [{ nodeIndex: 1, parentNodeIndex: 2 }])).toThrow(
      RangeError,
    );
    expect(() => moveNodes(nestedDocument(), [{ nodeIndex: 1, parentNodeIndex: 1 }])).toThrow(
      RangeError,
    );
  });

  test("refuses invalid destinations instead of corrupting the ranges", () => {
    expect(() => moveNodes(nestedDocument(), [{ nodeIndex: 4, parentNodeIndex: 2 }])).toThrow(
      RangeError,
    );
    expect(() =>
      moveNodes(nestedDocument(), [{ nodeIndex: 4, parentNodeIndex: 0, beforeNodeIndex: 2 }]),
    ).toThrow(RangeError);
    expect(() => moveNodes(nestedDocument(), [{ nodeIndex: 0, parentNodeIndex: 1 }])).toThrow(
      RangeError,
    );
  });
});
