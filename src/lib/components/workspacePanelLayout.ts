/**
 * dockview 面板布局策略：默认布局、还原、持久化快照、组约束、视口「洞」标记。
 *
 * 从 `GpenWorkspace.svelte` 里整块搬出来的（那个文件曾经 1800+ 行）：这一块自成一体
 * ——只依赖 dockview 实例、工作区状态和容器尺寸，不碰文档 / 图层 / 命令。搬出来之后
 * 组件只负责「什么时候调」，策略的注释（下面这些坑）集中在一处。
 *
 * 组件侧只提供三个 getter：dockview 实例、`workspaceState`（读写 `panelLayout`）、
 * 容器尺寸。测量视口本身留在组件里（它写组件的 `$state`），通过 `measure` 回调进来。
 *
 * 三个必须守住的不变量（都是踩过坑写下来的，改动前先读 `docs/panel.md`）：
 *
 * 1. **只在真实尺寸下取快照**：刚挂载时 dockview 还停在它自己的默认尺寸（100×100），
 *    此时每个面板都卡在最小值，`toJSON()` 存下来就是一个坏布局。
 * 2. **结构变更和尺寸变更都要订**：`onDidMutateLayout` 不管 sash 拖动，只订它的话
 *    用户拖过的面板宽度根本不会被持久化。
 * 3. **还原要等第一趟 layout**：容器尺寸来自 `visualViewport`，`onMount` 时还没算出来。
 */
import type { DockviewApi, SerializedDockview } from "dockview";

import { dropRestoredCodeAreaPanels } from "./codeArea/panels.js";
import {
  cloneGpenPanelLayout,
  type GpenPanelLayout,
  type GpenWorkspaceState,
} from "./gpenWorkspaceState";
import { COLUMN_MINIMUM_WIDTHS, minimumColumnWidths } from "./workspaceLayout.js";

export const STATUS_BAR_PANEL_ID = "statusbar";

/** 低于这个尺寸的布局不是“用户的布局”，见 `capture`。 */
export const MIN_LAYOUT_DIMENSION = 120;

/**
 * 各组的**高度**最小值（宽度的最小值随容器变，见 `workspaceLayout.ts`）。
 *
 * dockview 自己的组最小值是 100×100，而 `addPanel` 的 `minimumWidth/Height`
 * 只对新建组生效（split 出来的组会退回组默认值），所以建完布局还得
 * `setConstraints` 再落一次——两处都从这里取数，别写裸数字。
 */
export const CHROME_MINIMUM_HEIGHTS = { menu: 28, timeline: 48, statusbar: 22 } as const;

export interface PanelLayoutDeps {
  getDockview(): DockviewApi | undefined;
  /** 工作区状态（读 / 写 `panelLayout`）。 */
  getState(): GpenWorkspaceState;
  /** 每次布局前重测视口（写组件自己的 `$state`）。 */
  measure(): void;
  /** 容器未缩放 px 盒（`layoutWidth/Height`）；拿不到时退回 `clientWidth/Height`。 */
  getLayoutSize(): { width: number | undefined; height: number | undefined };
  getContainer(): HTMLElement | undefined;
}

export interface PanelLayoutController {
  /** 首屏：按存储决定「还原」还是「建默认布局」，并记一次快照。 */
  restoreOrBuildDefault(): void;
  /** 同步落一次布局（首屏用，之后都走 `schedule`）。 */
  layoutNow(): void;
  /** 合并到下一帧：重测 → 约束 → 布局 → 还原 / 默认尺寸 → 快照。 */
  schedule(): void;
  /** dockview 的布局事件（增删 / 激活 / 尺寸）：打「洞」标记 + 记快照。 */
  handleLayoutEvent(): void;
  /** 下一次布局时重落一遍默认尺寸（重新 add 面板后用，如状态栏）。 */
  applyDefaultSizesOnNextLayout(): void;
  /** 「重置面板布局」：丢掉存储里的布局并重建默认布局。 */
  reset(): void;
  dispose(): void;
}

export function createPanelLayoutController(deps: PanelLayoutDeps): PanelLayoutController {
  let frame: number | undefined;
  /** 存储里有布局 → 第一趟真实尺寸的 layout 之后再还原。 */
  let pendingRestore = false;
  /** `addPanel` 的 initial* 只在新建组时生效，默认尺寸要显式落一次。 */
  let applyDefaultSizes = false;
  /** 有「尺寸已定」的快照还没记（见 `handleLayoutEvent` 与 `schedule`）。 */
  let layoutDirty = false;

  function instance(): DockviewApi | undefined {
    return deps.getDockview();
  }

  function containerWidth(): number {
    return deps.getLayoutSize().width ?? deps.getContainer()?.clientWidth ?? 0;
  }

  function layoutNow(): void {
    const dockview = instance();
    if (!dockview) return;
    const width = deps.getLayoutSize().width ?? deps.getContainer()?.clientWidth ?? 0;
    const height = deps.getLayoutSize().height ?? deps.getContainer()?.clientHeight ?? 0;
    if (width <= 0 || height <= 0) return;
    dockview.layout(width, height);
  }

  /**
   * `initialWidth` / `initialHeight` on addPanel only apply when the panel
   * creates its group; panels that split an existing group keep the group
   * minimum instead. Set every default size explicitly, once the grid exists.
   */
  function resizeDefaultPanels(): void {
    const dockview = instance();
    dockview?.getPanel("menu")?.group.api.setSize({ height: 66 });
    dockview?.getPanel("tools")?.group.api.setSize({ width: 62 });
    dockview?.getPanel("outliner")?.group.api.setSize({ width: 300 });
    dockview?.getPanel("timeline")?.group.api.setSize({ height: 190 });
    dockview?.getPanel(STATUS_BAR_PANEL_ID)?.group.api.setSize({ height: 24 });
  }

  function capture(): void {
    const dockview = instance();
    // 一个没有任何面板的布局不是“用户的布局”：它只会在重建的中途或渲染异常时
    // 出现，存下去就等于把工作区锁死成空白。
    if (!dockview || dockview.panels.length === 0) return;
    // 只有“按真实容器尺寸排过的布局”才值得存。刚挂载时 dockview 还停在它自己的
    // 默认尺寸（100×100），那时每个面板都卡在最小值；把这时的 toJSON() 存下来，
    // 下次还原就会被摊回真实尺寸 —— 面板越开越大就是这么来的。
    const { width, height } = deps.getLayoutSize();
    if (width === undefined || height === undefined) return;
    if (Math.abs(dockview.width - width) > 1 || Math.abs(dockview.height - height) > 1) return;
    const layout = cloneGpenPanelLayout(dockview.toJSON());
    if (!layout) return;
    deps.getState().panelLayout = layout;
    layoutDirty = false;
  }

  /**
   * 视口那一组是 overlay 上真正的“洞”：整组透明、且不接指针（见 themes/dockview.css
   * 的 `.gpen-hole`）。以前只靠 `:has(.blender-panel-viewport)` 判断，面板内容一旦缺失
   * （组件抛错、还没挂载），洞就会退回不透明的 chrome 底色——所以这里按面板 id 打标记。
   * 面板的增删、激活、尺寸变化都会触发 dockview 的布局事件，所以这一处调用就够了
   * （在 rAF 里再来一次是消融实验证伪掉的冗余：去掉后洞依然是透明的）。
   */
  function markHoleGroup(): void {
    const dockview = instance();
    if (!dockview) return;
    for (const group of dockview.groups) {
      group.element.classList.toggle("gpen-hole", group.activePanel?.id === "viewport");
    }
  }

  /** 存储里的布局是否是“按真实尺寸排过”的那份（老版本可能存过 100×100 的）。 */
  function isUsablePanelLayout(layout: GpenPanelLayout): boolean {
    const grid = (layout as { grid?: { width?: unknown; height?: unknown } }).grid;
    if (typeof grid !== "object" || grid === null) return false;
    const { width, height } = grid;
    return (
      typeof width === "number" &&
      typeof height === "number" &&
      width >= MIN_LAYOUT_DIMENSION &&
      height >= MIN_LAYOUT_DIMENSION
    );
  }

  function restore(): boolean {
    const dockview = instance();
    const stored = deps.getState().panelLayout;
    if (!dockview || !stored) return false;
    if (!isUsablePanelLayout(stored)) {
      // 坏布局直接丢掉，让调用方重建默认布局。
      deps.getState().panelLayout = null;
      return false;
    }
    try {
      dockview.fromJSON(stored as unknown as SerializedDockview);
    } catch (error) {
      console.debug("[gpen] ignored rejection: workspace panel layout restore", error);
      deps.getState().panelLayout = null;
      return false;
    }
    // 调试面板（CodeArea）不跨会话保留，详见 `dropRestoredCodeAreaPanels`。
    dropRestoredCodeAreaPanels(dockview);
    // 存储里的布局可能是空的（见 capture）：`fromJSON` 不会抛，
    // 但结果是一个没有面板的 workspace，所以这里当成恢复失败处理。
    if (dockview.panels.length === 0) {
      dockview.clear();
      deps.getState().panelLayout = null;
      return false;
    }
    return true;
  }

  /**
   * 把高度 / 宽度约束落到 dockview 组上（建布局后一次，容器尺寸变时每次）。
   * 策略本体在 `workspaceLayout.ts`：窄容器必须收小三列的 `minimumWidth`，
   * 否则 dockview 会把**整个网格**撑到 452px，每列右侧被裁到容器外——顶栏动作按钮、
   * 右侧「场景集合 / 属性」全都点不到（详见那里的注释）。
   */
  function applyGroupConstraints(available: number): void {
    const dockview = instance();
    if (!dockview) return;
    for (const [id, minimumHeight] of Object.entries(CHROME_MINIMUM_HEIGHTS)) {
      dockview.getPanel(id)?.group.api.setConstraints({ minimumHeight });
    }
    const { tools, viewport, side } = minimumColumnWidths(available);
    dockview.getPanel("tools")?.group.api.setConstraints({ minimumWidth: tools });
    dockview.getPanel("viewport")?.group.api.setConstraints({ minimumWidth: viewport });
    dockview.getPanel("outliner")?.group.api.setConstraints({ minimumWidth: side });
    dockview.getPanel("properties")?.group.api.setConstraints({ minimumWidth: side });
  }

  /**
   * Build outward from the viewport so every surrounding panel occupies its own
   * dockview group and stays resizable. Sizes are CSS px at the workspace's own
   * (unzoomed) scale: the tool strip is a rail, the right column is the
   * layer/property work area, and the top / bottom strips are chrome whose
   * height follows their content.
   */
  function buildDefaultLayout(): void {
    const dockview = instance();
    if (!dockview) return;
    dockview.addPanel({
      id: "viewport",
      component: "viewport",
      title: "视口",
      minimumWidth: COLUMN_MINIMUM_WIDTHS.viewport,
      minimumHeight: 160,
    });
    dockview.addPanel({
      id: "menu",
      component: "menu",
      title: "菜单",
      position: { referencePanel: "viewport", direction: "above" },
      initialHeight: 66,
      minimumHeight: CHROME_MINIMUM_HEIGHTS.menu,
    });
    dockview.addPanel({
      id: "tools",
      component: "tools",
      title: "工具",
      position: { referencePanel: "viewport", direction: "left" },
      initialWidth: 62,
      minimumWidth: COLUMN_MINIMUM_WIDTHS.tools,
    });
    dockview.addPanel({
      id: "timeline",
      component: "timeline",
      title: "时间轴",
      position: { referencePanel: "viewport", direction: "below" },
      initialHeight: 190,
      minimumHeight: CHROME_MINIMUM_HEIGHTS.timeline,
    });
    dockview.addPanel({
      id: "outliner",
      component: "outliner",
      title: "场景集合",
      position: { referencePanel: "viewport", direction: "right" },
      initialWidth: 300,
      minimumWidth: COLUMN_MINIMUM_WIDTHS.side,
    });
    dockview.addPanel({
      id: "properties",
      component: "properties",
      title: "属性",
      position: { referencePanel: "outliner", direction: "below" },
      initialHeight: 320,
    });
    dockview.addPanel({
      id: "statusbar",
      component: "statusbar",
      title: "状态栏",
      position: { referencePanel: "timeline", direction: "below" },
      initialHeight: 24,
      minimumHeight: 22,
    });

    // dockview 组默认最小值 100×100，而 `addPanel` 的 minimum* 只对新建组生效：
    // 建完布局把约束表整体落一次（`CHROME_MINIMUM_HEIGHTS` / `COLUMN_MINIMUM_WIDTHS`）。
    applyGroupConstraints(containerWidth());
  }

  function schedule(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      deps.measure();
      applyGroupConstraints(containerWidth());
      layoutNow();
      // Both of these need a laid-out grid: dockview ignores size requests
      // made before the first layout pass (the grid falls back to each
      // group's minimum), and a restored layout applied before the container
      // has its real size gets its panel sizes redistributed — which is how
      // a stored layout ends up "growing" panels.
      if (pendingRestore) {
        pendingRestore = false;
        if (!restore()) {
          buildDefaultLayout();
          applyDefaultSizes = true;
          schedule();
          return;
        }
      }
      if (applyDefaultSizes) {
        applyDefaultSizes = false;
        resizeDefaultPanels();
      }
      // 尺寸落定后再落一次布局：`setSize` 之后的变更事件是在 dockview 还在
      // 100×100 时发出的，那一次会被 capture 的尺寸守卫挡掉。
      if (layoutDirty) capture();
    });
  }

  return {
    restoreOrBuildDefault() {
      // The stored layout is applied in the first animation-frame pass instead of
      // here: at this point the container has not been sized yet (the overlay is
      // positioned from `visualViewport` in an effect that has not run), so
      // dockview would fit the restored tree into a wrong dimension.
      pendingRestore = deps.getState().panelLayout !== null;
      if (!pendingRestore) {
        buildDefaultLayout();
        applyDefaultSizes = true;
      }
      capture();
    },
    layoutNow,
    schedule,
    handleLayoutEvent() {
      layoutDirty = true;
      markHoleGroup();
      capture();
    },
    applyDefaultSizesOnNextLayout() {
      applyDefaultSizes = true;
    },
    reset() {
      const dockview = instance();
      if (!dockview) return;
      deps.getState().panelLayout = null;
      dockview.clear();
      buildDefaultLayout();
      // `clear()` + re-add happens before the next layout pass, so the explicit
      // sizes have to run on that pass (same as the first mount).
      applyDefaultSizes = true;
      schedule();
    },
    dispose() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    },
  };
}
