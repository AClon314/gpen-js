import { beforeEach, describe, expect, test } from "bun:test";

/**
 * `contextMenu.svelte.ts` 的注册表 / 打开 / 锚定 / 快捷绑定。
 *
 * 这是一张 `.svelte.ts`（反应式 state 用 `$state`），bun 不编译 runes，所以先给
 * `$state` 一个恒等实现再动态 import：`menuState` 只需要"一个可变对象"，本文件
 * 的断言也只看它。DOM 与浏览器事件桥接（`document` / `window` 监听）在 bun 里
 * 不进分支，由 e2e（`tests/e2e/context-menu.e2e.ts`）覆盖。
 */
const runtime = globalThis as unknown as { $state?: <T>(value: T) => T };
runtime.$state ??= <T>(value: T) => value;

const { close, contextMenu, listMenuIds, menuState, open, openAt, registerMenuItems } =
  await import("../src/lib/components/contextMenu/contextMenu.svelte.ts");

/** `openAt` 只用到 `getBoundingClientRect()`，不需要真的 DOM 元素。 */
function anchorAt(rect: { left: number; top: number; bottom: number; right: number }): Element {
  return {
    getBoundingClientRect: () => ({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    }),
  } as unknown as Element;
}

beforeEach(() => {
  close();
  menuState.items = [];
});

describe("open", () => {
  test("refuses an empty registry", () => {
    expect(open("missing", 40, 40)).toBe(false);
    expect(menuState.visible).toBe(false);
  });

  test("collects global and named items in order", () => {
    const disposeGlobal = registerMenuItems("*", [{ label: "global", order: 1 }]);
    const disposeNamed = registerMenuItems("named", [{ label: "named", order: 2 }]);
    try {
      const version = menuState.openVersion;
      expect(open("named", 40, 60)).toBe(true);
      expect(menuState.visible).toBe(true);
      expect(menuState.items.map((item) => item.label)).toEqual(["global", "named"]);
      expect(menuState.openVersion).toBe(version + 1);
    } finally {
      disposeNamed();
      disposeGlobal();
    }
  });

  test("increments openVersion on every open", () => {
    const dispose = registerMenuItems("*", [{ label: "a" }]);
    try {
      const version = menuState.openVersion;
      open("*", 0, 0);
      open("*", 0, 0);
      expect(menuState.openVersion).toBe(version + 2);
    } finally {
      dispose();
    }
  });
});

describe("close", () => {
  test("hides the menu and drops the anchor", () => {
    const dispose = registerMenuItems("*", [{ label: "a" }]);
    try {
      open("*", 0, 0, anchorAt({ left: 0, top: 0, bottom: 20, right: 40 }));
      close();
      expect(menuState.visible).toBe(false);
      expect(menuState.anchor).toBeNull();
    } finally {
      dispose();
    }
  });
});

describe("openAt", () => {
  test("places the menu below its anchor", () => {
    const dispose = registerMenuItems("anchor", [{ label: "a" }]);
    try {
      expect(openAt("anchor", anchorAt({ left: 100, top: 100, bottom: 120, right: 160 }))).toBe(
        true,
      );
      // viewport 高度未知（bun 无 window）→ 一律翻到锚点上方：100 - 2 - 48 = 50。
      expect(menuState.x).toBe(100);
      expect(menuState.y).toBe(50);
      expect(menuState.anchor).not.toBeNull();
    } finally {
      dispose();
    }
  });
});

describe("listMenuIds", () => {
  test("excludes the global bucket and anonymous ids", () => {
    const node = { dataset: {} } as unknown as HTMLElement;
    const action = contextMenu(node, [{ label: "anon" }]);
    const dispose = registerMenuItems("named", [{ label: "named" }]);
    try {
      expect(listMenuIds()).toEqual(["named"]);
      expect(node.dataset.contextMenuId?.startsWith("__context_menu_")).toBe(true);
    } finally {
      dispose();
      action.destroy?.();
    }
  });
});
