/**
 * The menu bar model: one `MenuItem[]` provider per menu, all built from
 * command ids.
 *
 * This is the T9 "menu spread" in one file instead of ~40 inline actions in
 * `TopBar.svelte`. Nodes reference commands (`{ command: "gpen.save" }`), so
 * the menu, the shortcut and the (later) command palette cannot disagree; the
 * *actions* live in `workspaceCommands.ts` next to the rest of the command
 * registry.
 *
 * The rules the handoff fixes:
 *
 * - **no "clicked and nothing happened"**: an entry with no implementation is
 *   `disabled: true` + a `title` explaining why, never a silent no-op;
 * - separators group the real entries the way Blender's menus do (labels and
 *   order come from `tmp/menus.png`);
 * - `keyBind` is **display only** — every displayed chord is also registered in
 *   `registerWorkspaceKeyBindings()` (a displayed shortcut that does nothing is
 *   the same false promise as a dead entry);
 * - labels come from the command registry (`resolveMenuLabel` falls back to the
 *   command's own label), so an entry that is just a command id needs no label
 *   at all.
 *
 * Menu ids are stable (`gpen-file-menu`, …) so tests and the command palette
 * can enumerate them, and `TopBar` disposes every registration on unmount.
 */
import type { MenuItem } from "./contextMenu/menuModel.js";
import { GPEN_COMMAND_IDS } from "./workspaceCommands.js";

export const GPEN_MENU_IDS = {
  file: "gpen-file-menu",
  edit: "gpen-edit-menu",
  render: "gpen-render-menu",
  window: "gpen-window-menu",
  help: "gpen-help-menu",
  toggle: "gpen-toggle-menu",
  utilities: "gpen-utilities-menu",
  settings: "gpen-settings-menu",
} as const;

export type GpenMenuId = (typeof GPEN_MENU_IDS)[keyof typeof GPEN_MENU_IDS];

/** Title every not-yet-implemented entry carries, so hover explains itself. */
export const NOT_IMPLEMENTED_TITLE = "尚未实现";

/** A disabled placeholder: visible (so the menu matches the reference) but honest. */
export function todo(label: string, order: number, title = NOT_IMPLEMENTED_TITLE): MenuItem {
  return { label, order, disabled: true, title };
}

/** The menu bar, in bar order. `label` is what the button shows. */
export const GPEN_MENU_BAR: readonly { id: GpenMenuId; label: string }[] = [
  { id: GPEN_MENU_IDS.file, label: "文件" },
  { id: GPEN_MENU_IDS.edit, label: "编辑" },
  { id: GPEN_MENU_IDS.render, label: "渲染" },
  { id: GPEN_MENU_IDS.window, label: "窗口" },
  { id: GPEN_MENU_IDS.help, label: "帮助" },
  { id: GPEN_MENU_IDS.toggle, label: "切换" },
  { id: GPEN_MENU_IDS.utilities, label: "实用工具" },
];

/** 文件 */
export function fileMenuItems(): MenuItem[] {
  return [
    { command: GPEN_COMMAND_IDS.newDocument, order: 10 },
    { command: GPEN_COMMAND_IDS.openDocument, order: 20 },
    { command: GPEN_COMMAND_IDS.openRecent, order: 30 },
    { separator: true, order: 40 },
    // 显示用的快捷键提示来自命令注册表（`keyBind`），菜单节点不重复写一份：
    // 否则菜单和快捷键会各写各的文案，正是 handoff 要防的「假承诺」。
    { command: GPEN_COMMAND_IDS.save, order: 50 },
    { command: GPEN_COMMAND_IDS.saveCopy, order: 60 },
    { separator: true, order: 70 },
    { command: GPEN_COMMAND_IDS.debugInternalJsonState, order: 80 },
    { separator: true, order: 90 },
    todo("重新加载", 100),
    todo("恢复", 110),
    todo("增量保存", 120),
    todo("关联…", 130),
    todo("追加…", 140),
    todo("数据预览", 150),
    { separator: true, order: 160 },
    todo("导入", 170),
    todo("导出所有集合", 180),
    todo("外部数据", 190),
    todo("清理", 200),
    todo("默认", 210),
    { separator: true, order: 220 },
    { command: GPEN_COMMAND_IDS.closeWorkspace, order: 230 },
  ];
}

/** 编辑 */
export function editMenuItems(): MenuItem[] {
  return [
    { command: GPEN_COMMAND_IDS.undo, order: 10 },
    { command: GPEN_COMMAND_IDS.redo, order: 20 },
    todo("重做历史", 30),
    todo("调整上一步操作…", 40, "尚未实现（F9）"),
    todo("重复上一步", 50, "尚未实现（Shift+R）"),
    todo("重复历史", 60),
    { separator: true, order: 70 },
    todo("菜单搜索…", 80, "尚未实现（F3）：等命令枚举稳定后再做"),
    todo("操作搜索", 90),
    { separator: true, order: 100 },
    { command: GPEN_COMMAND_IDS.renameActive, order: 110 },
    todo("批量重命名…", 120, "尚未实现（Ctrl+F2）"),
    todo("锁定物体模式", 130),
    { separator: true, order: 140 },
    { command: GPEN_COMMAND_IDS.openPreferences, order: 150 },
  ];
}

/** 渲染 */
export function renderMenuItems(): MenuItem[] {
  return [todo("渲染图像", 10), todo("渲染动画", 20), todo("视图渲染", 30)];
}

/** 窗口 */
export function windowMenuItems(): MenuItem[] {
  return [
    { command: GPEN_COMMAND_IDS.resetPanelLayout, order: 10 },
    { command: GPEN_COMMAND_IDS.toggleImmersive, order: 20 },
    { command: GPEN_COMMAND_IDS.toggleFullscreen, order: 30 },
    { separator: true, order: 40 },
    todo("新建窗口", 50),
    todo("新建主窗口", 60),
    todo("前一个工作区", 70, "尚未实现（Ctrl+PageUp）"),
    todo("后一个工作区", 80, "尚未实现（Ctrl+PageDown）"),
    todo("保存屏幕截图…", 90),
    todo("保存屏幕截图（编辑器）…", 100),
  ];
}

/** 切换 */
export function toggleMenuItems(): MenuItem[] {
  return [
    { command: GPEN_COMMAND_IDS.toggleStatusBar, order: 10 },
    { separator: true, order: 20 },
    todo("工作区切换", 30, "尚未实现：需要协议 WorkspaceUi 那条链"),
    todo("显示叠加层", 40),
  ];
}

/** 实用工具 */
export function utilitiesMenuItems(): MenuItem[] {
  return [
    todo("添加物体", 10),
    todo("添加集合", 20),
    todo("重载脚本", 30),
    todo("内存统计", 40),
    todo("调试菜单", 50),
    todo("重设计时器", 60),
    todo("清理空间数据", 70),
    todo("清理操作项预设", 80),
  ];
}

/** 帮助 */
export function helpMenuItems(): MenuItem[] {
  return [
    { command: GPEN_COMMAND_IDS.openDocs, order: 10 },
    { command: GPEN_COMMAND_IDS.reportIssue, order: 20 },
    { separator: true, order: 30 },
    todo("手册", 40),
    todo("支持", 50),
    todo("用户社区", 60),
    todo("参与进来", 70),
    todo("发布说明", 80),
    todo("开发者社区", 90),
    todo("Python API 手册", 100),
    todo("操作项信息一览", 110),
    { command: GPEN_COMMAND_IDS.about, order: 120 },
  ];
}

/** 设置（齿轮按钮） */
export function settingsMenuItems(): MenuItem[] {
  return [{ command: GPEN_COMMAND_IDS.openPreferences, order: 10 }];
}

/** Provider for a menu id (used by `TopBar`'s `registerMenuItems`). */
export function menuProvider(id: string): (() => MenuItem[]) | undefined {
  switch (id) {
    case GPEN_MENU_IDS.file:
      return fileMenuItems;
    case GPEN_MENU_IDS.edit:
      return editMenuItems;
    case GPEN_MENU_IDS.render:
      return renderMenuItems;
    case GPEN_MENU_IDS.window:
      return windowMenuItems;
    case GPEN_MENU_IDS.help:
      return helpMenuItems;
    case GPEN_MENU_IDS.toggle:
      return toggleMenuItems;
    case GPEN_MENU_IDS.utilities:
      return utilitiesMenuItems;
    case GPEN_MENU_IDS.settings:
      return settingsMenuItems;
    default:
      return undefined;
  }
}
