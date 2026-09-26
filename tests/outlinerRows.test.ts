import { describe, expect, test } from "bun:test";

import type { UiLayerTreeNode } from "../src/lib/layers/types";
import type { TreeRow } from "../src/lib/layers/tree";
import {
  TYPEAHEAD_TIMEOUT_MS,
  appendTypeahead,
  expandedAfterToggle,
  isPlainCharacter,
  isWithinSubtree,
  outlinerKeyAction,
  structuralToggle,
} from "../src/lib/components/areas/outlinerRows";

/* ------------------------------------------------------------------ fixture */

/**
 * 行表只用到 key / parentKey / hasChildren：
 *
 *   Root(0)          level 1
 *   ├── G1(1)        level 2
 *   │   └── Alpha(2) level 3
 *   └── Gamma(3)     level 2
 */
function row(key: number, parentKey: number | null, hasChildren: boolean): TreeRow {
  return {
    key,
    parentKey,
    level: 1,
    hasChildren,
    textValue: `row-${key}`,
    data: {} as unknown as UiLayerTreeNode,
  };
}

const ROWS: TreeRow[] = [row(0, null, true), row(1, 0, true), row(2, 1, false), row(3, 0, false)];

describe("outlinerKeyAction", () => {
  test("maps the arrow / Home / End keys to tree moves", () => {
    expect(outlinerKeyAction("ArrowUp", {})).toEqual({ kind: "move", move: "up" });
    expect(outlinerKeyAction("ArrowDown", {})).toEqual({ kind: "move", move: "down" });
    expect(outlinerKeyAction("ArrowLeft", {})).toEqual({ kind: "move", move: "left" });
    expect(outlinerKeyAction("ArrowRight", {})).toEqual({ kind: "move", move: "right" });
    expect(outlinerKeyAction("Home", {})).toEqual({ kind: "move", move: "home" });
    expect(outlinerKeyAction("End", {})).toEqual({ kind: "move", move: "end" });
  });

  test("maps Enter and F2", () => {
    expect(outlinerKeyAction("Enter", {})).toEqual({ kind: "activate" });
    expect(outlinerKeyAction("F2", {})).toEqual({ kind: "rename" });
  });

  test("turns a plain character into a typeahead action", () => {
    expect(outlinerKeyAction("a", {})).toEqual({ kind: "typeahead", character: "a" });
  });

  test("ignores characters while a modifier is held", () => {
    expect(outlinerKeyAction("a", { ctrlKey: true })).toBeUndefined();
    expect(outlinerKeyAction("a", { metaKey: true })).toBeUndefined();
    expect(outlinerKeyAction("a", { altKey: true })).toBeUndefined();
  });

  test("ignores unrelated or multi-character keys", () => {
    expect(outlinerKeyAction("Escape", {})).toBeUndefined();
    expect(outlinerKeyAction("Shift", {})).toBeUndefined();
  });
});

describe("isPlainCharacter", () => {
  test("is true only for a single character without modifiers", () => {
    expect(isPlainCharacter("a", {})).toBe(true);
    expect(isPlainCharacter("ab", {})).toBe(false);
    expect(isPlainCharacter("a", { ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
  });
});

describe("expandedAfterToggle", () => {
  test("adds a collapsed key and removes an expanded one", () => {
    expect([...expandedAfterToggle(new Set([1]), 2)]).toEqual([1, 2]);
    expect([...expandedAfterToggle(new Set([1, 2]), 1)]).toEqual([2]);
  });

  test("returns a new set and leaves the input untouched", () => {
    const input = new Set([1]);
    const next = expandedAfterToggle(input, 2);
    expect(next).not.toBe(input);
    expect([...input]).toEqual([1]);
  });
});

describe("structuralToggle", () => {
  const expanded = new Set([1]);

  test("collapses an expanded group on left", () => {
    expect(structuralToggle("left", ROWS[1], expanded)).toBe("collapse");
  });

  test("expands a collapsed group on right", () => {
    expect(structuralToggle("right", ROWS[1], new Set())).toBe("expand");
  });

  test("does nothing when the state already matches", () => {
    expect(structuralToggle("left", ROWS[1], new Set())).toBeUndefined();
    expect(structuralToggle("right", ROWS[1], expanded)).toBeUndefined();
  });

  test("does nothing for leaves, unknown rows or other moves", () => {
    expect(structuralToggle("left", ROWS[2], expanded)).toBeUndefined();
    expect(structuralToggle("left", undefined, expanded)).toBeUndefined();
    expect(structuralToggle("up", ROWS[1], expanded)).toBeUndefined();
  });
});

describe("isWithinSubtree", () => {
  test("includes the node itself and its descendants", () => {
    expect(isWithinSubtree(ROWS, 1, 1)).toBe(true);
    expect(isWithinSubtree(ROWS, 1, 2)).toBe(true);
  });

  test("excludes siblings and ancestors", () => {
    expect(isWithinSubtree(ROWS, 1, 3)).toBe(false);
    expect(isWithinSubtree(ROWS, 2, 0)).toBe(false);
  });
});

describe("appendTypeahead", () => {
  test("appends while the previous keystroke is fresh", () => {
    expect(appendTypeahead("ab", "c", 1000, 1100)).toBe("abc");
  });

  test("restarts the prefix after the timeout", () => {
    expect(appendTypeahead("ab", "c", 1000, 1000 + TYPEAHEAD_TIMEOUT_MS + 1)).toBe("c");
  });

  test("starts a brand-new prefix from an empty buffer", () => {
    expect(appendTypeahead("", "a", 0, 0)).toBe("a");
  });
});
