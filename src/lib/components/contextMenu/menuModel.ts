/**
 * 上下文菜单的模型层（纯函数，无 Svelte / 无 DOM）。
 *
 * 这里放的是右键菜单里可以 `bun test` 的那部分：节点求值（label / disabled /
 * when / children）、分隔项判定、线性键盘导航。`contextMenu.svelte.ts` 只负责注册表与
 * 浏览器事件桥接，`ContextMenu.svelte` 只负责渲染与焦点——「逻辑与框架解耦」。
 *
 * 菜单与命令是**分家**的（见 AGENTS / handoff）：菜单是树，节点用 `id` 引用命令 id
 * （`builtin.draw` / `gpen.open_file` / `addon.<vendor>.<op>`）。本层不解析命令，
 * 只保证 id 原样透传，留给命令注册表。
 */

/** 菜单节点种类；省略时按 `separator`/`children` 推导。 */
export type MenuItemType = "command" | "menu" | "separator";

export type MenuItem = {
  /** 引用的命令 id；等于协议 `ToolReference.idname`，零转换。 */
  id?: string;
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

export type MenuItemProvider = MenuItem[];
export type MenuItemProviderInput = MenuItem[] | (() => MenuItem[]);

export type MenuNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** 求值一个菜单节点列表（数组或惰性 getter）。 */
export function resolveMenuItems(provider: MenuItemProviderInput | undefined): MenuItem[] {
  if (!provider) return [];
  return (typeof provider === "function" ? provider() : provider) ?? [];
}

export function resolveMenuLabel(item: MenuItem): string {
  const label = item.label;
  if (typeof label === "function") return label();
  return label ?? "";
}

export function resolveMenuDisabled(item: MenuItem): boolean {
  const disabled = item.disabled;
  if (typeof disabled === "function") return disabled();
  return disabled ?? false;
}

export function resolveMenuVisible(item: MenuItem): boolean {
  const when = item.when;
  if (typeof when === "function") return when();
  return when ?? true;
}

/** 子菜单是否应参与渲染：`type: "menu"` 或显式提供了非空 children。 */
export function resolveMenuChildren(item: MenuItem): MenuItem[] {
  const children = resolveMenuItems(item.children);
  if (children.length > 0) return children;
  return [];
}

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
  const focusable: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item && isMenuFocusable(item)) focusable.push(index);
  }
  if (focusable.length === 0) return -1;

  if (key === "Home") return focusable[0] ?? -1;
  if (key === "End") return focusable[focusable.length - 1] ?? -1;

  const count = focusable.length;
  if (key === "ArrowUp") {
    const before = focusable.filter((index) => index < current);
    return before.length > 0 ? (before[before.length - 1] ?? -1) : (focusable[count - 1] ?? -1);
  }

  const after = focusable.filter((index) => index > current);
  return after.length > 0 ? (after[0] ?? -1) : (focusable[0] ?? -1);
}

/** 把 `keyBind` 归一成 `Ctrl+Z` 形式的显示文本。 */
export function formatKeyBind(keyBind: string | readonly string[] | undefined): string {
  if (!keyBind) return "";
  return (typeof keyBind === "string" ? [keyBind] : keyBind).join("+");
}
