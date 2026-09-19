import { describe, expect, test } from "bun:test";

import {
  formatKeyBind,
  isMenuFocusable,
  isMenuSeparator,
  nextMenuIndex,
  resolveMenuChildren,
  resolveMenuDisabled,
  resolveMenuLabel,
  resolveMenuVisible,
  visibleMenuItems,
  type MenuItem,
} from "../src/lib/components/contextMenu/menuModel";

describe("menu item resolution", () => {
  test("resolves static and getter labels", () => {
    expect(resolveMenuLabel({ label: "打开" })).toBe("打开");
    expect(resolveMenuLabel({ label: () => "另存" })).toBe("另存");
    expect(resolveMenuLabel({})).toBe("");
  });

  test("resolves disabled from boolean or predicate", () => {
    expect(resolveMenuDisabled({ disabled: true })).toBe(true);
    expect(resolveMenuDisabled({ disabled: () => false })).toBe(false);
    expect(resolveMenuDisabled({})).toBe(false);
  });

  test("resolves visibility from boolean or predicate", () => {
    expect(resolveMenuVisible({ when: false })).toBe(false);
    expect(resolveMenuVisible({ when: () => true })).toBe(true);
    expect(resolveMenuVisible({})).toBe(true);
  });

  test("filters invisible nodes but keeps separators", () => {
    const items: MenuItem[] = [
      { label: "a" },
      { label: "hidden", when: false },
      { separator: true },
      { label: "b", when: () => false },
    ];
    expect(visibleMenuItems(items).map(resolveMenuLabel)).toEqual(["a", ""]);
  });

  test("treats both separator spellings as separators", () => {
    expect(isMenuSeparator({ separator: true })).toBe(true);
    expect(isMenuSeparator({ type: "separator" })).toBe(true);
    expect(isMenuSeparator({ label: "x" })).toBe(false);
  });

  test("returns children only when they exist", () => {
    expect(resolveMenuChildren({ label: "x" })).toEqual([]);
    expect(resolveMenuChildren({ children: [] })).toEqual([]);
    expect(resolveMenuChildren({ children: [{ label: "y" }] })).toHaveLength(1);
  });

  test("separators and disabled items are not focusable", () => {
    expect(isMenuFocusable({ label: "x" })).toBe(true);
    expect(isMenuFocusable({ separator: true })).toBe(false);
    expect(isMenuFocusable({ label: "x", disabled: true })).toBe(false);
    expect(isMenuFocusable({ label: "x", when: false })).toBe(false);
  });
});

describe("menu keyboard navigation", () => {
  const items: MenuItem[] = [
    { label: "a" },
    { separator: true },
    { label: "b", disabled: true },
    { label: "c" },
    { label: "d" },
  ];

  test("skips separators and disabled items when moving down", () => {
    expect(nextMenuIndex(items, -1, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(items, 0, "ArrowDown")).toBe(3);
    expect(nextMenuIndex(items, 3, "ArrowDown")).toBe(4);
  });

  test("wraps around at both ends", () => {
    expect(nextMenuIndex(items, 4, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(items, 0, "ArrowUp")).toBe(4);
    expect(nextMenuIndex(items, -1, "ArrowUp")).toBe(4);
  });

  test("home and end jump to the first and last focusable item", () => {
    expect(nextMenuIndex(items, 3, "Home")).toBe(0);
    expect(nextMenuIndex(items, 0, "End")).toBe(4);
  });

  test("returns -1 when nothing is focusable", () => {
    expect(
      nextMenuIndex([{ separator: true }, { label: "x", disabled: true }], -1, "ArrowDown"),
    ).toBe(-1);
    expect(nextMenuIndex([], 0, "Home")).toBe(-1);
  });
});

describe("menu key bind hint", () => {
  test("formats strings and key lists", () => {
    expect(formatKeyBind(undefined)).toBe("");
    expect(formatKeyBind("Ctrl+Z")).toBe("Ctrl+Z");
    expect(formatKeyBind(["Ctrl", "Shift", "Z"])).toBe("Ctrl+Shift+Z");
  });
});
