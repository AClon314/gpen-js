/**
 * 上下文菜单的模型层（纯函数，无 Svelte / 无 DOM）。
 *
 * 这里放的是右键菜单里可以 `bun test` 的那部分：节点求值（label / disabled /
 * when / children）、分隔项判定、线性键盘导航。`contextMenu.svelte.ts` 只负责注册表与
 * 浏览器事件桥接，`ContextMenu.svelte` 只负责渲染与焦点——「逻辑与框架解耦」。
 *
 * 菜单与命令是**分家**的（见 AGENTS / handoff）：菜单是树，节点用 `command` 引用命令 id
 * （`builtin.draw` / `gpen.save` / `addon.<vendor>.<op>`）。本层不执行命令，只做两件事：
 * 原样透传 id，以及把命令注册表里的 `when` / `enabled` 合并进节点求值——否则菜单会
 * 显示一个按不动、或该消失却没消失的项（那是「假承诺」，handoff 明确禁止）。
 */
import { commandEnabled, commandVisible, getCommand } from "../../commands/commands.js";
import { evaluatePredicate } from "../../predicates.js";

/** 菜单节点种类；省略时按 `separator`/`children` 推导。 */
export type MenuItemType = "command" | "menu" | "separator";

/** 一个菜单节点：标签、命令引用、可见性 / 禁用谓词与子菜单。 */
export type MenuItem = {
  /** 引用的命令 id；等于协议 `ToolReference.idname`，零转换。 */
  id?: string;
  /** 命令 id（与 `action` 二选一）。节点执行时走 `executeCommand(command)`。 */
  command?: string;
  type?: MenuItemType;
  label?: string | (() => string);
  /** 仅用于显示的快捷键提示（真实匹配走 keymap，不在这里解析）。 */
  keyBind?: string | readonly string[];
  /** 可见性谓词；求值为 false 时该节点不渲染、也不参与键盘导航。 */
  when?: boolean | (() => boolean);
  /** 子菜单节点（`type: "menu"`）。 */
  children?: MenuItemProvider;
  disabled?: boolean | (() => boolean);
  action?: () => void;
  /** 兼容旧字段：等价于 `type: "separator"`。 */
  separator?: boolean;
  order?: number;
  [key: string]: unknown;
};

/** 已求值的菜单节点数组。 */
export type MenuItemProvider = MenuItem[];
/** 菜单节点数组，或返回它的惰性函数。 */
export type MenuItemProviderInput = MenuItem[] | (() => MenuItem[]);

/** 菜单内线性导航支持的按键。 */
export type MenuNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** 求值一个菜单节点列表（数组或惰性 getter）。 */
export function resolveMenuItems(provider: MenuItemProviderInput | undefined): MenuItem[] {
  if (!provider) return [];
  return (typeof provider === "function" ? provider() : provider) ?? [];
}

/** 求值节点标签：函数取调用结果，缺省则回退到命令的 label。 */
export function resolveMenuLabel(item: MenuItem): string {
  const label = item.label;
  if (typeof label === "function") return label();
  if (label !== undefined) return label;
  // 只给了命令 id 时，标签直接取命令自己的 label（菜单与快捷键不会各写一份文案）。
  const command = item.command === undefined ? undefined : getCommand(item.command);
  if (!command) return "";
  return typeof command.label === "function" ? command.label() : command.label;
}

/**
 * 快捷键**提示**：节点自己写了就用它，否则回退到命令注册表的 `keyBind`。
 *
 * 只用于显示（真正的匹配在 keymap）；但取值同源是重点：菜单不重复写一遍
 * "Ctrl+S"，命令改了绑定菜单就跟着改。
 */
export function resolveMenuKeyBind(item: MenuItem): string | readonly string[] | undefined {
  if (item.keyBind !== undefined) return item.keyBind;
  const command = item.command === undefined ? undefined : getCommand(item.command);
  return command?.keyBind;
}

/**
 * 节点是否禁用：节点自己的 `disabled` 与命令注册表的 `enabled` 合并，
 * 任一说「不可用」就是禁用。谓词抛错按 `false` 处理（见 predicates.ts）。
 */
export function resolveMenuDisabled(item: MenuItem): boolean {
  if (evaluatePredicate(item.disabled, false, "menu item disabled")) return true;
  if (item.command === undefined) return false;
  return !commandEnabled(getCommand(item.command));
}

/**
 * 节点是否可见：节点的 `when` 与命令的 `when` 都要为真，并且命令必须存在
 * （引用了一个没注册的 id 的菜单项不该渲染出来）。
 */
export function resolveMenuVisible(item: MenuItem): boolean {
  if (!evaluatePredicate(item.when, true, "menu item when")) return false;
  if (item.command === undefined) return true;
  const command = getCommand(item.command);
  if (!command) return false;
  return commandVisible(command);
}

/** 子菜单是否应参与渲染：`type: "menu"` 或显式提供了非空 children。 */
export function resolveMenuChildren(item: MenuItem): MenuItem[] {
  const children = resolveMenuItems(item.children);
  if (children.length > 0) return children;
  return [];
}

/** 是否是分隔项（`separator: true` 或 `type: "separator"`）。 */
export function isMenuSeparator(item: MenuItem): boolean {
  return item.separator === true || item.type === "separator";
}

/** 过滤掉不可见节点；分隔项可见性交给调用方/样式（不在这里裁剪）。 */
export function visibleMenuItems(items: readonly MenuItem[]): MenuItem[] {
  return items.filter((item) => resolveMenuVisible(item));
}

/** 可聚焦 = 不是分隔项、未禁用、且可见（调用方应传已过滤的列表）。 */
export function isMenuFocusable(item: MenuItem): boolean {
  return !isMenuSeparator(item) && !resolveMenuDisabled(item) && resolveMenuVisible(item);
}

/** 可聚焦节点的下标（升序）：跳过分隔项、禁用项与不可见项。 */
function focusableIndices(items: readonly MenuItem[]): number[] {
  const focusable: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item && isMenuFocusable(item)) focusable.push(index);
  }
  return focusable;
}

/**
 * 在可聚焦下标里按方向找下一个，到头就从另一头环绕。
 *
 * `direction` 为 -1 表示向上（取当前之前最靠近的一个），为 1 表示向下。
 */
function stepFocusIndex(focusable: readonly number[], current: number, direction: -1 | 1): number {
  const candidates = focusable.filter((index) =>
    direction < 0 ? index < current : index > current,
  );
  if (candidates.length === 0) {
    return (direction < 0 ? focusable[focusable.length - 1] : focusable[0]) ?? -1;
  }
  return (direction < 0 ? candidates[candidates.length - 1] : candidates[0]) ?? -1;
}

/**
 * 线性键盘导航：返回下一个应聚焦的兄弟下标，没有可聚焦项时返回 -1。
 *
 * `ArrowUp` / `ArrowDown` 环绕；`Home` / `End` 取首/末个可聚焦项（都跳过禁用与分隔）。
 * `current` 用 -1 表示"还没有聚焦项"。
 */
export function nextMenuIndex(
  items: readonly MenuItem[],
  current: number,
  key: MenuNavigationKey,
): number {
  const focusable = focusableIndices(items);
  if (focusable.length === 0) return -1;

  if (key === "Home") return focusable[0] ?? -1;
  if (key === "End") return focusable[focusable.length - 1] ?? -1;
  return stepFocusIndex(focusable, current, key === "ArrowUp" ? -1 : 1);
}

/** 把 `keyBind` 归一成 `Ctrl+Z` 形式的显示文本。 */
export function formatKeyBind(keyBind: string | readonly string[] | undefined): string {
  if (!keyBind) return "";
  return (typeof keyBind === "string" ? [keyBind] : keyBind).join("+");
}
