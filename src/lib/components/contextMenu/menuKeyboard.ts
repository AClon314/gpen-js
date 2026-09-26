/**
 * 上下文菜单的键盘意图层（纯函数，无 Svelte / 无 DOM）。
 *
 * `ContextMenu.svelte` 只把 `keydown` 翻译成意图，DOM 焦点移动仍留在组件里：
 * 上下 / Home / End 交给 `menuModel.ts` 的 `nextMenuIndex`，Enter / Space 激活，
 * 左右进出子菜单。拆出这一层，一是让组件里的按键分支只剩一次查表（CCN 降下来），
 * 二是「哪些键在哪些条件下有动作」可以被单测固定（`tests/menuPosition.test.ts`
 * 只覆盖几何，这里由 `tests/menuKeyboard.test.ts` 单独守）。
 */
import type { MenuNavigationKey } from "./menuModel.js";

/** 菜单项上的按键意图；`undefined` 表示这个键不归菜单处理。 */
export type MenuKeyIntent =
  | { kind: "activate" }
  | { kind: "enter" }
  | { kind: "leave" }
  | { kind: "move"; key: MenuNavigationKey };

/** 触发激活的按键（Enter 与空格）。 */
const ACTIVATE_KEYS: ReadonlySet<string> = new Set(["Enter", " "]);

/** 线性导航键 → `menuModel` 的导航方向（其余为 undefined）。 */
const NAVIGATION_KEYS: Record<string, MenuNavigationKey | undefined> = {
  ArrowDown: "ArrowDown",
  ArrowUp: "ArrowUp",
  Home: "Home",
  End: "End",
};

/** 根容器用的线性导航键查询：`undefined` 表示这个键不移动焦点。 */
export function menuNavigationKey(key: string): MenuNavigationKey | undefined {
  return NAVIGATION_KEYS[key];
}

/**
 * 把菜单项的按键翻译成导航意图。
 *
 * @param key 事件的 `KeyboardEvent.key`
 * @param hasChildren 当前项是否有子菜单（决定 ArrowRight 是否有效）
 * @param depth 当前项在菜单树里的层数（根层为 1；决定 ArrowLeft 是否有效）
 */
export function menuItemKeyIntent(
  key: string,
  hasChildren: boolean,
  depth: number,
): MenuKeyIntent | undefined {
  if (ACTIVATE_KEYS.has(key)) return { kind: "activate" };
  const move = menuNavigationKey(key);
  if (move !== undefined) return { kind: "move", key: move };
  if (key === "ArrowRight" && hasChildren) return { kind: "enter" };
  if (key === "ArrowLeft" && depth > 1) return { kind: "leave" };
  return undefined;
}
