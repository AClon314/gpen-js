import { beforeEach, describe, expect, test } from "bun:test";

import { clearCommands, getCommand, registerCommand } from "../src/lib/commands";
import {
  editMenuItems,
  fileMenuItems,
  GPEN_MENU_BAR,
  GPEN_MENU_IDS,
  helpMenuItems,
  menuProvider,
  NOT_IMPLEMENTED_TITLE,
  renderMenuItems,
  settingsMenuItems,
  toggleMenuItems,
  utilitiesMenuItems,
  windowMenuItems,
} from "../src/lib/components/menuBar";
import {
  resolveMenuDisabled,
  resolveMenuLabel,
  resolveMenuVisible,
} from "../src/lib/components/contextMenu/menuModel";
import { GPEN_COMMAND_IDS } from "../src/lib/components/workspaceCommands";

/** Register every id a menu references, so visibility/disabled resolve. */
function registerAll(ids: readonly string[]): void {
  for (const id of ids) registerCommand({ id, label: `label:${id}`, run: () => {} });
}

function commandIdsOf(items: readonly { command?: string }[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.command !== undefined) ids.push(item.command);
    const children = (item as { children?: { command?: string }[] }).children;
    if (children) ids.push(...commandIdsOf(children));
  }
  return ids;
}

beforeEach(() => {
  clearCommands();
});

describe("menu bar model", () => {
  test("the bar lists the seven menus from the reference image", () => {
    expect(GPEN_MENU_BAR.map((menu) => menu.label)).toEqual([
      "文件",
      "编辑",
      "渲染",
      "窗口",
      "帮助",
      "切换",
      "实用工具",
    ]);
    // Every bar entry has a provider, so no button opens an empty menu.
    for (const menu of GPEN_MENU_BAR) expect(typeof menuProvider(menu.id)).toBe("function");
    expect(typeof menuProvider(GPEN_MENU_IDS.settings)).toBe("function");
  });

  test("every menu resolves to items with a label or a command", () => {
    const menus = [
      fileMenuItems(),
      editMenuItems(),
      renderMenuItems(),
      windowMenuItems(),
      toggleMenuItems(),
      utilitiesMenuItems(),
      helpMenuItems(),
      settingsMenuItems(),
    ];
    for (const items of menus) {
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        if (item.separator) continue;
        expect(item.command !== undefined || item.label !== undefined).toBe(true);
      }
    }
  });

  test("no entry is a silent no-op: it is either a command or disabled with a title", () => {
    for (const items of [fileMenuItems(), editMenuItems(), renderMenuItems(), windowMenuItems()]) {
      for (const item of items) {
        if (item.separator) continue;
        const hasCommand = item.command !== undefined;
        const isDisabled = item.disabled === true;
        // A node with neither command nor action, and not disabled, would render
        // as clickable-but-dead. That is exactly what the handoff forbids.
        const hasAction = typeof item.action === "function";
        expect(hasCommand || isDisabled || hasAction).toBe(true);
        if (!hasCommand && !hasAction) expect(typeof item.title).toBe("string");
      }
    }
  });

  test("disabled placeholders carry the not-implemented title", () => {
    const placeholders = fileMenuItems().filter(
      (item) => item.disabled === true && item.command === undefined,
    );
    expect(placeholders.length).toBeGreaterThan(0);
    for (const item of placeholders) {
      expect(String(item.title)).toContain("尚未实现");
    }
    // The explicit default is the shared constant.
    expect(NOT_IMPLEMENTED_TITLE).toBe("尚未实现");
  });

  test("labels fall back to the command's own label", () => {
    registerCommand({ id: GPEN_COMMAND_IDS.save, label: "保存", run: () => {} });
    const save = fileMenuItems().find((item) => item.command === GPEN_COMMAND_IDS.save);
    expect(save).toBeDefined();
    expect(resolveMenuLabel(save!)).toBe("保存");
  });

  test("an entry referencing an unregistered command is hidden", () => {
    const save = fileMenuItems().find((item) => item.command === GPEN_COMMAND_IDS.save);
    expect(save).toBeDefined();
    // Nothing registered yet: rendering it would promise an action that cannot run.
    expect(resolveMenuVisible(save!)).toBe(false);
    registerCommand({ id: GPEN_COMMAND_IDS.save, label: "保存", run: () => {} });
    expect(resolveMenuVisible(save!)).toBe(true);
  });

  test("a disabled command greys the menu entry out", () => {
    registerCommand({
      id: GPEN_COMMAND_IDS.undo,
      label: "撤销",
      enabled: () => false,
      run: () => {},
    });
    const undo = editMenuItems().find((item) => item.command === GPEN_COMMAND_IDS.undo);
    expect(undo).toBeDefined();
    expect(resolveMenuDisabled(undo!)).toBe(true);
    expect(resolveMenuVisible(undo!)).toBe(true);
  });

  test("every displayed shortcut hint has a real command behind it", () => {
    // The menu's `keyBind` is display-only; the binding lives in the keymap.
    // This asserts the ids are the shared constants (so the two cannot drift).
    const ids = [
      ...commandIdsOf(fileMenuItems()),
      ...commandIdsOf(editMenuItems()),
      ...commandIdsOf(windowMenuItems()),
      ...commandIdsOf(helpMenuItems()),
      ...commandIdsOf(settingsMenuItems()),
    ];
    expect(ids).toContain(GPEN_COMMAND_IDS.save);
    expect(ids).toContain(GPEN_COMMAND_IDS.undo);
    expect(ids).toContain(GPEN_COMMAND_IDS.openPreferences);
    expect(ids).toContain(GPEN_COMMAND_IDS.toggleFullscreen);
    // Ids are dotted, protocol-style.
    for (const id of ids) expect(id).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  test("the settings and window menus expose the preference / layout entries", () => {
    registerAll(Object.values(GPEN_COMMAND_IDS));
    const settings = settingsMenuItems();
    expect(settings.map((item) => item.command)).toContain(GPEN_COMMAND_IDS.openPreferences);
    const windowItems = windowMenuItems().map((item) => item.command);
    expect(windowItems).toContain(GPEN_COMMAND_IDS.resetPanelLayout);
    expect(windowItems).toContain(GPEN_COMMAND_IDS.toggleImmersive);
    expect(windowItems).toContain(GPEN_COMMAND_IDS.toggleFullscreen);
    expect(getCommand(GPEN_COMMAND_IDS.resetPanelLayout)).toBeDefined();
  });
});
