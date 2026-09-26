import { describe, expect, test } from "bun:test";

import {
  menuItemKeyIntent,
  menuNavigationKey,
} from "../src/lib/components/contextMenu/menuKeyboard";

describe("menuNavigationKey", () => {
  test("recognises the four linear navigation keys", () => {
    expect(menuNavigationKey("ArrowDown")).toBe("ArrowDown");
    expect(menuNavigationKey("ArrowUp")).toBe("ArrowUp");
    expect(menuNavigationKey("Home")).toBe("Home");
    expect(menuNavigationKey("End")).toBe("End");
  });

  test("returns undefined for everything else", () => {
    expect(menuNavigationKey("ArrowLeft")).toBeUndefined();
    expect(menuNavigationKey("a")).toBeUndefined();
  });
});

describe("menuItemKeyIntent", () => {
  test("activates on Enter and Space", () => {
    expect(menuItemKeyIntent("Enter", true, 1)).toEqual({ kind: "activate" });
    expect(menuItemKeyIntent(" ", false, 1)).toEqual({ kind: "activate" });
  });

  test("maps the linear keys to move intents", () => {
    expect(menuItemKeyIntent("ArrowDown", false, 1)).toEqual({ kind: "move", key: "ArrowDown" });
    expect(menuItemKeyIntent("End", true, 2)).toEqual({ kind: "move", key: "End" });
  });

  test("ArrowRight enters a submenu only when there is one", () => {
    expect(menuItemKeyIntent("ArrowRight", true, 1)).toEqual({ kind: "enter" });
    expect(menuItemKeyIntent("ArrowRight", false, 1)).toBeUndefined();
  });

  test("ArrowLeft leaves a submenu only when nested", () => {
    expect(menuItemKeyIntent("ArrowLeft", false, 2)).toEqual({ kind: "leave" });
    expect(menuItemKeyIntent("ArrowLeft", true, 1)).toBeUndefined();
  });

  test("ignores unrelated keys", () => {
    expect(menuItemKeyIntent("a", true, 2)).toBeUndefined();
    expect(menuItemKeyIntent("Escape", true, 2)).toBeUndefined();
  });
});
