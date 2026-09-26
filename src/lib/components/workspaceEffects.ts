/**
 * 工作区挂载期的订阅 / 监听注册（`onMount` 的尾巴 / `onDestroy` 对应部分）。
 *
 * 从 `GpenWorkspace.svelte` 搬出来的：这一段是**一组正交的副作用登记**——
 * tab 菜单、contextmenu、捕获阶段 Escape、命令与快捷键、视口监听、三个缩放修正
 * （sash / 浮窗拖动 / 浮窗 resize）、容器 ResizeObserver。它们在坞床里的顺序不重要，
 * 但**每一个都必须在卸载时对称注销**，所以集中在一个 `start()` / `dispose()` 里。
 *
 * 消融实测：去掉三个缩放修正后 `tests/e2e/workspace-zoom.e2e.ts` 6 条里 5 条失败，
 * 所以这里不是「为行数搬家」，而是把成对的登记 / 注销收进一个可控的生命周期。
 */
import { observeViewport } from "#lib/visualViewport";
import { registerMenuItems } from "./contextMenu/contextMenu.svelte";
import { installFloatingDragZoomCorrection } from "./workspaceFloatingDrag";
import { installFloatingResizeZoomCorrection } from "./workspaceFloatingResize";
import { installSashZoomCorrection } from "./workspaceSashZoom";
import { WORKSPACE_TAB_MENU_ID, type WorkspaceTabMenu } from "./workspaceTabMenu.js";

/** `createWorkspaceEffects` 需要的宿主能力（函数引用必须稳定，注销时要用同一个）。 */
export interface WorkspaceEffectsDeps {
  container: HTMLElement;
  tabMenu: WorkspaceTabMenu;
  handleEscapePriority(event: KeyboardEvent): void;
  registerCommands(): () => void;
  getZoom(): number;
  onViewportChange(): void;
  /** 布局快照要记的变更（浮窗拖动 / resize 结束）。 */
  onLayoutChange(): void;
}

/** 工作区挂载期副作用的登记 / 注销句柄。 */
export interface WorkspaceEffects {
  start(): void;
  dispose(): void;
}

/** 创建挂载期副作用集合（`onMount` 调 `start()`，`onDestroy` 调 `dispose()`）。 */
export function createWorkspaceEffects(deps: WorkspaceEffectsDeps): WorkspaceEffects {
  let disposeTabMenu: (() => void) | undefined;
  let disposeCommands: (() => void) | undefined;
  let removeViewportListeners: (() => void) | undefined;
  let viewportResizeObserver: ResizeObserver | undefined;
  let disposeSashZoom: (() => void) | undefined;
  let disposeFloatingDrag: (() => void) | undefined;
  let disposeFloatingResize: (() => void) | undefined;

  function start(): void {
    const { container, tabMenu } = deps;
    disposeTabMenu = registerMenuItems(WORKSPACE_TAB_MENU_ID, tabMenu.items);
    container.addEventListener("contextmenu", tabMenu.handleContextMenu);
    // 捕获阶段：Esc 先收浮动面板，别让它直接关掉整个工作区。
    window.addEventListener("keydown", deps.handleEscapePriority, { capture: true });
    disposeCommands = deps.registerCommands();

    removeViewportListeners = observeViewport(deps.onViewportChange);
    disposeSashZoom = installSashZoomCorrection({
      container,
      getZoom: deps.getZoom,
    }).dispose;
    disposeFloatingDrag = installFloatingDragZoomCorrection({
      container,
      getZoom: deps.getZoom,
      // 自己写的 left/top 也要进布局快照（`toJSON()` 读的就是它们）。
      onDragEnd: deps.onLayoutChange,
    }).dispose;
    disposeFloatingResize = installFloatingResizeZoomCorrection({
      container,
      getZoom: deps.getZoom,
      // 同拖动：resize 后的 width/height 也要进布局快照。
      onResizeEnd: deps.onLayoutChange,
    }).dispose;

    const parent = container.parentElement;
    if (typeof ResizeObserver !== "undefined" && parent) {
      viewportResizeObserver = new ResizeObserver(() => deps.onViewportChange());
      viewportResizeObserver.observe(parent);
    }
  }

  function dispose(): void {
    disposeSashZoom?.();
    disposeSashZoom = undefined;
    disposeFloatingDrag?.();
    disposeFloatingDrag = undefined;
    disposeFloatingResize?.();
    disposeFloatingResize = undefined;
    removeViewportListeners?.();
    removeViewportListeners = undefined;
    viewportResizeObserver?.disconnect();
    viewportResizeObserver = undefined;
    deps.container.removeEventListener("contextmenu", deps.tabMenu.handleContextMenu);
    window.removeEventListener("keydown", deps.handleEscapePriority, { capture: true });
    disposeCommands?.();
    disposeCommands = undefined;
    disposeTabMenu?.();
    disposeTabMenu = undefined;
  }

  return { start, dispose };
}
