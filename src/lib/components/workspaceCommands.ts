/**
 * The built-in `gpen.*` commands, registered against the workspace.
 *
 * Why a deps object instead of registering inside `GpenWorkspace.svelte`: the
 * workspace component owns dockview, storage and the document, and would
 * otherwise grow one more 80-line block of unrelated command plumbing. Here the
 * *policy* (ids, labels, shortcut hints, availability) is in one readable
 * place, and the *mechanism* (what "toggle status bar" does to dockview) stays
 * in the component that owns it.
 *
 * Ids are dotted and stable — they are the same strings the menu bar references
 * (`{ command: "gpen.save" }`) and the same ones the keymap binds, so a menu
 * item and its shortcut can never point at two different actions.
 */
import { registerCommand } from "../commands.js";
import { registerKeyBinding } from "../commands/keymap.js";

/** Everything the built-in commands need from the workspace. */
export interface WorkspaceCommandDeps {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Start inline renaming of the active outliner row; false when there is none. */
  renameActive(): boolean;
  resetPanelLayout(): void;
  toggleImmersive(): void;
  immersive(): boolean;
  toggleStatusBar(): void;
  statusBarVisible(): boolean;
  /** Flush the document to gpenBinary immediately (no debounce). */
  save(): void;
  toggleFullscreen(): void;
  fullscreen(): boolean;
  /** Open the floating preferences panel (idempotent). */
  openPreferences(): void;
  /** Show the version (the help menu's "about"). */
  openAbout(): void;
  /** Replace the document with a fresh default one (undoable). */
  newDocument(): void;
  /** Reopen the stored document, discarding in-memory changes. */
  openDocument(): void;
  /** Reopen the most recently saved document (only `gpen-main` exists today). */
  openRecent(): void;
  /** Save the current document under a new id (copy). */
  saveCopy(): void;
  /** Download the document as a FlatBuffer (`.gpen.json`). */
  exportJson(): void;
  /** Close the workspace (give the page back). */
  closeWorkspace(): void;
}

export const GPEN_COMMAND_IDS = {
  undo: "gpen.undo",
  redo: "gpen.redo",
  renameActive: "gpen.rename_active",
  resetPanelLayout: "gpen.reset_panel_layout",
  toggleImmersive: "gpen.toggle_immersive",
  toggleStatusBar: "gpen.toggle_statusbar",
  toggleFullscreen: "gpen.toggle_fullscreen",
  save: "gpen.save",
  saveCopy: "gpen.save_copy",
  newDocument: "gpen.new",
  openDocument: "gpen.open",
  openRecent: "gpen.open_recent",
  exportJson: "gpen.export_json",
  closeWorkspace: "gpen.close_workspace",
  about: "gpen.about",
  openPreferences: "gpen.open_preferences",
  reportIssue: "gpen.report_issue",
  openDocs: "gpen.open_docs",
} as const;

/** Repository the help menu points at (verified origin of this workspace). */
export const GPEN_REPOSITORY_URL = "https://github.com/AClon314/gpen";
export const GPEN_DOCS_URL = `${GPEN_REPOSITORY_URL}/tree/main/gpen-js/docs`;
export const GPEN_ISSUE_URL = `${GPEN_REPOSITORY_URL}/issues/new`;

/** Open a URL in a new tab; the browser may block it, which is not an error. */
function openExternal(url: string): void {
  if (typeof window === "undefined") return;
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    console.debug("[gpen] ignored rejection: openExternal", error);
    return;
  }
}

/** Build-time version constant (`vite.config.ts` `define`); safe in tests. */
function gpenVersion(): string {
  return typeof __GPEN_VERSION__ === "string" ? __GPEN_VERSION__ : "unknown";
}

/** Register every built-in command. Returns a disposer for all of them. */
export function registerWorkspaceCommands(deps: WorkspaceCommandDeps): () => void {
  const disposers = [
    registerCommand({
      id: GPEN_COMMAND_IDS.undo,
      label: "撤销",
      keyBind: "Ctrl+Z",
      enabled: () => deps.canUndo(),
      run: () => deps.undo(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.redo,
      label: "重做",
      keyBind: ["Ctrl+Shift+Z", "Ctrl+Y"],
      enabled: () => deps.canRedo(),
      run: () => deps.redo(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.renameActive,
      label: "重命名活动项",
      keyBind: "F2",
      enabled: () => deps.renameActive !== undefined,
      run: () => {
        deps.renameActive();
      },
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.resetPanelLayout,
      label: "重置面板布局",
      run: () => deps.resetPanelLayout(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.toggleImmersive,
      label: () => (deps.immersive() ? "退出沉浸模式" : "沉浸模式"),
      run: () => deps.toggleImmersive(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.toggleStatusBar,
      label: "显示状态栏",
      enabled: () => true,
      run: () => deps.toggleStatusBar(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.toggleFullscreen,
      label: () => (deps.fullscreen() ? "退出全屏" : "切换全屏"),
      run: () => deps.toggleFullscreen(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.save,
      label: "保存",
      keyBind: "Ctrl+S",
      run: () => deps.save(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.newDocument,
      label: "新建",
      keyBind: "Ctrl+N",
      run: () => deps.newDocument(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.openDocument,
      label: "打开…",
      keyBind: "Ctrl+O",
      run: () => deps.openDocument(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.openRecent,
      label: "打开最近文件",
      keyBind: "Shift+Ctrl+O",
      run: () => deps.openRecent(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.saveCopy,
      label: "保存副本…",
      keyBind: "Shift+Ctrl+S",
      run: () => deps.saveCopy(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.exportJson,
      label: "导出 JSON",
      run: () => deps.exportJson(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.closeWorkspace,
      label: "退出",
      keyBind: "Ctrl+Q",
      run: () => deps.closeWorkspace(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.about,
      label: () => `关于 gpen（v${gpenVersion()}）`,
      run: () => deps.openAbout(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.openPreferences,
      label: "偏好设置",
      keyBind: "Ctrl+Alt+U",
      run: () => deps.openPreferences(),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.reportIssue,
      label: "报告问题",
      run: () => openExternal(GPEN_ISSUE_URL),
    }),
    registerCommand({
      id: GPEN_COMMAND_IDS.openDocs,
      label: "开发文档",
      run: () => openExternal(GPEN_DOCS_URL),
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

/**
 * Bind the chords the menus advertise.
 *
 * `Ctrl+S` / `Ctrl+O` / `Ctrl+Z` are shown in the menu, so they have to be real
 * bindings — a displayed shortcut that does nothing is a false promise. The
 * gates keep them from stealing keys outside their context (the workspace is
 * unmounted while minimized/closed anyway, but the `when` predicates make the
 * intent explicit).
 */
export function registerWorkspaceKeyBindings(): () => void {
  const disposers = [
    registerKeyBinding({ key: "Ctrl+Z", command: GPEN_COMMAND_IDS.undo }),
    registerKeyBinding({ key: ["Ctrl+Shift+Z", "Ctrl+Y"], command: GPEN_COMMAND_IDS.redo }),
    registerKeyBinding({ key: "F2", command: GPEN_COMMAND_IDS.renameActive }),
    registerKeyBinding({ key: "Ctrl+S", command: GPEN_COMMAND_IDS.save }),
    registerKeyBinding({ key: "Ctrl+N", command: GPEN_COMMAND_IDS.newDocument }),
    registerKeyBinding({ key: "Ctrl+O", command: GPEN_COMMAND_IDS.openDocument }),
    registerKeyBinding({ key: "Ctrl+Shift+O", command: GPEN_COMMAND_IDS.openRecent }),
    registerKeyBinding({ key: "Ctrl+Shift+S", command: GPEN_COMMAND_IDS.saveCopy }),
    registerKeyBinding({ key: "Ctrl+Alt+U", command: GPEN_COMMAND_IDS.openPreferences }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
