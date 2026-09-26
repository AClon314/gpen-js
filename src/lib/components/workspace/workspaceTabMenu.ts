/**
 * 工作区 tab 的右键菜单 + timeline 占位面板的图层列表。
 *
 * 从 `GpenWorkspace.svelte` 搬出来的：tab 的 DOM 归 dockview 所有（用不了 `contextMenu`
 * action），所以这一段是「代理式」的——监听 `container` 上的 `contextmenu`、认出 `.dv-tab`、
 * 再用命名注册表打开菜单。它只依赖 dockview 实例、图层树与容器，和文档 / 命令无关。
 */
import type { DockviewApi } from "dockview";
import { MimeType } from "gpen-protocol/flatbuffers";

import type { UiLayerTree } from "../../layers/types";
import { open as openMenu } from "../contextMenu/contextMenu.svelte";
import type { MenuItem } from "../contextMenu/menuModel";

/** 工作区 tab 右键菜单的注册 id。 */
export const WORKSPACE_TAB_MENU_ID = "gpen-workspace-tab";

/** tab 菜单需要的宿主 getter（dockview、图层树、容器）。 */
export interface WorkspaceTabMenuDeps {
  getDockview(): DockviewApi | undefined;
  /** timeline 占位面板的图层树（`layerTree` 是 `$derived`，所以用 getter）。 */
  getLayerTree(): UiLayerTree | undefined;
  /** tab 命中判定用的容器（`container.contains(tab)`）。 */
  getContainer(): HTMLElement | undefined;
}

/** 工作区 tab 的右键菜单（节点、事件监听、图层列表）。 */
export interface WorkspaceTabMenu {
  /** 注册表用的节点提供者。 */
  items(): MenuItem[];
  /** `container` 上的 `contextmenu` 监听。 */
  handleContextMenu(event: MouseEvent): void;
  /** timeline 占位面板的图层列表 DOM。 */
  createLayerList(): HTMLUListElement;
}

/** 创建 tab 右键菜单。 */
export function createWorkspaceTabMenu(deps: WorkspaceTabMenuDeps): WorkspaceTabMenu {
  /** 右键落在哪个 tab 上（`items()` 是同步取的，所以菜单打开期间要靠它）。 */
  let panelId: string | undefined;

  // Open the owning panel in a separate browser window (like an OAuth popup).
  // dockview needs a popoutUrl so the new window can boot the same app; a
  // fragment marks which panel is being popped out.
  function popoutPanel(id: string): void {
    const dockview = deps.getDockview();
    const panel = dockview?.getPanel(id);
    if (!dockview || !panel) return;
    const url = `${window.location.origin}${window.location.pathname}#popout-${id}`;
    try {
      void dockview.addPopoutGroup(panel, { popoutUrl: url });
    } catch (e) {
      // Popout may be blocked (no window.open permission); ignore.
      console.debug("[gpen] ignored rejection: workspace tab popout", e);
      return;
    }
  }

  /**
   * The tab DOM belongs to dockview, so it cannot use the Svelte action. The
   * delegated `contextmenu` listener resolves the tab's panel id and opens this
   * named registry entry programmatically instead.
   */
  function items(): MenuItem[] {
    const current = panelId;
    if (current === undefined) return [];
    return [
      { label: "在新窗口打开", order: 10, action: () => popoutPanel(current) },
      {
        label: "关闭",
        order: 20,
        action: () => {
          const panel = deps.getDockview()?.getPanel(current);
          if (panel) deps.getDockview()?.removePanel(panel);
        },
      },
      { separator: true, order: 30 },
      {
        label: "浮动",
        order: 40,
        action: () => {
          const dockview = deps.getDockview();
          const panel = dockview?.getPanel(current);
          if (dockview && panel) dockview.addFloatingGroup(panel);
        },
      },
    ];
  }

  function handleContextMenu(event: MouseEvent): void {
    const container = deps.getContainer();
    const target = event.target;
    if (!container || !(target instanceof Element)) return;
    const tab = target.closest<HTMLElement>(".dv-tab");
    if (!tab || !container.contains(tab)) return;

    const id = tab.dataset.tabPanelId;
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    panelId = id;
    openMenu(WORKSPACE_TAB_MENU_ID, event.clientX, event.clientY);
  }

  /** timeline 占位面板（还没注册组件的面板）里的图层列表。 */
  function createLayerList(): HTMLUListElement {
    const list = document.createElement("ul");
    list.className = "gpen-layer-list";
    const layers = deps.getLayerTree()?.flattenedDrawOrder() ?? [];
    if (layers.length === 0) {
      const empty = document.createElement("li");
      empty.className = "gpen-layer-empty";
      empty.textContent = "暂无图层";
      list.appendChild(empty);
      return list;
    }
    for (const layer of layers) {
      const li = document.createElement("li");
      li.className = `gpen-layer-row${layer.active ? " gpen-layer-row-active" : ""}`;

      const label = document.createElement("span");
      label.className = "gpen-layer-name";
      label.textContent = layer.name;
      li.appendChild(label);

      const isGpen = layer.layer?.mimeType === MimeType.MIME_TYPE_APPLICATION_GPEN;
      const badge = document.createElement("span");
      badge.className = `gpen-layer-kind gpen-layer-kind-${isGpen ? "gpen" : "html"}`;
      badge.textContent = isGpen ? "gpen" : "html";
      li.appendChild(badge);

      if (layer.active) {
        const active = document.createElement("span");
        active.className = "gpen-layer-active";
        active.setAttribute("aria-hidden", "true");
        active.textContent = "●";
        li.appendChild(active);
      }

      list.appendChild(li);
    }
    return list;
  }

  return { items, handleContextMenu, createLayerList };
}
