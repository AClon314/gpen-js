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
 * 三个必须守住的不变量（都是踩过坑写下来的，改动前先读 `src/lib/components/README-panel.md`）：
 *
 * 1. **只在真实尺寸下取快照**：刚挂载时 dockview 还停在它自己的默认尺寸（100×100），
 *    此时每个面板都卡在最小值，`toJSON()` 存下来就是一个坏布局。
 * 2. **结构变更和尺寸变更都要订**：`onDidMutateLayout` 不管 sash 拖动，只订它的话
 *    用户拖过的面板宽度根本不会被持久化。
 * 3. **还原要等第一趟 layout**：容器尺寸来自 `visualViewport`，`onMount` 时还没算出来。
 */
import type { DockviewApi, DockviewGroupPanel, SerializedDockview } from "dockview";

import { dropRestoredCodeAreaPanels } from "../codeArea/panels.js";
import {
  cloneGpenPanelLayout,
  type GpenPanelLayout,
  type GpenWorkspaceState,
} from "../gpenWorkspaceState";
import {
  centeredFloatingBounds,
  COLUMN_MINIMUM_WIDTHS,
  minimumColumnWidths,
} from "./workspaceLayout.js";
import { floatingLocalBox, type FloatingLocalBox } from "./workspaceFloatingGeometry.js";

/** 状态栏面板的固定 id。 */
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

/** 容器可用尺寸（两个方向都 > 0）。 */
function hasUsableSize(box: { width: number; height: number }): boolean {
  return box.width > 0 && box.height > 0;
}

/** 与上次检查的容器尺寸相同（只在这才早退，避免每帧重落位）。 */
function isSameSize(
  previous: { width: number; height: number } | undefined,
  box: { width: number; height: number },
): boolean {
  return previous !== undefined && previous.width === box.width && previous.height === box.height;
}

/** 局部盒是否完整落在容器内（+1 容差）。 */
function isInsideContainer(
  local: FloatingLocalBox,
  box: { width: number; height: number },
): boolean {
  return (
    local.left >= 0 &&
    local.top >= 0 &&
    local.left + local.width <= box.width + 1 &&
    local.top + local.height <= box.height + 1
  );
}

/** 面板布局控制器需要的宿主 getter（dockview、工作区状态、容器尺寸、浮窗参数）。 */
export interface PanelLayoutDeps {
  getDockview(): DockviewApi | undefined;
  /** 工作区状态（读 / 写 `panelLayout`）。 */
  getState(): GpenWorkspaceState;
  /** 每次布局前重测视口（写组件自己的 `$state`）。 */
  measure(): void;
  /** 容器未缩放 px 盒（`layoutWidth/Height`）；拿不到时退回 `clientWidth/Height`。 */
  getLayoutSize(): { width: number | undefined; height: number | undefined };
  getContainer(): HTMLElement | undefined;
  /** 浮动面板的首选尺寸（按面板 id）：装不下时用它重算落位。 */
  getFloatingPreferred(panelId: string): { width: number; height: number } | undefined;
  /** 浮窗与容器边缘的最小间距（与首次打开时同一个值）。 */
  getFloatingMargin(): number;
}

/** 浮窗首选尺寸：优先宿主给定，否则退回当前局部尺寸。 */
function resolvePreferredSize(
  local: FloatingLocalBox,
  panelId: string,
  deps: PanelLayoutDeps,
): { width: number; height: number } {
  return deps.getFloatingPreferred(panelId) ?? { width: local.width, height: local.height };
}

/**
 * 若该浮窗组装不下容器，返回重算后的 bounds；否则 null
 * （非浮动 / 无 resize 容器 / 已在容器内都返回 null）。
 */
function overflowingFloatingBounds(
  group: DockviewGroupPanel,
  container: HTMLElement,
  box: { width: number; height: number },
  deps: PanelLayoutDeps,
): ReturnType<typeof centeredFloatingBounds> | null {
  if (group.api.location.type !== "floating") return null;
  const element = group.element.closest<HTMLElement>(".dv-resize-container");
  if (!element) return null;
  const local = floatingLocalBox(element, container);
  if (isInsideContainer(local, box)) return null;
  const panelId = group.activePanel?.id ?? group.id;
  const preferred = resolvePreferredSize(local, panelId, deps);
  return centeredFloatingBounds(box, preferred, deps.getFloatingMargin());
}

/** 面板布局控制器：默认布局、尺寸约束、快照与浮窗夹取。 */
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
  /** 容器变小 / 还原布局之后，把**装不下**的浮窗拉回容器内（用户自己摆的、装得下的不碰）。 */
  reclampFloatingGroups(): void;
  dispose(): void;
}

/** 用宿主 getter 创建面板布局控制器。 */
export function createPanelLayoutController(deps: PanelLayoutDeps): PanelLayoutController {
  let frame: number | undefined;
  /** 存储里有布局 → 第一趟真实尺寸的 layout 之后再还原。 */
  let pendingRestore = false;
  /** `addPanel` 的 initial* 只在新建组时生效，默认尺寸要显式落一次。 */
  let applyDefaultSizes = false;
  /** 有「尺寸已定」的快照还没记（见 `handleLayoutEvent` 与 `schedule`）。 */
  let layoutDirty = false;
  /**
   * 上一次夹回检查时的容器尺寸。滚动 / pinch 平移不改容器尺寸，却会让 `observeViewport`
   * 每帧触发一次 `schedule()` —— 若每帧都检查浮窗，`bottom/right` 对齐的浮窗会被
   * 误判成越界而反复重落位（见 `reclampFloatingGroups`）。所以只在尺寸真的变了时检查。
   */
  let lastReclampSize: { width: number; height: number } | undefined;

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

  /**
   * 浮窗夹回：dockview 的 `floatingGroupBounds` 只约束**用户拖动**，不管初始请求、
   * 也不管容器变小（`constrainBounds` 只夹位置、不改尺寸）。所以这里在每趟布局末尾检查
   * 「局部盒是否还在容器内」，只对**装不下**的浮窗重算一次落位
   * （`centeredFloatingBounds`：缩到装得下 + 居中）；装得下的不动——不碰用户摆好的位置。
   *
   * `addFloatingGroup(panel, …)` 对已在浮动的组是「删组 + 重建浮窗」（面板实例不销毁），
   * 所以只在真的越界时才调，别每帧都调。
   *
   * 两个容易踩的点：
   *
   * 1. **只在容器尺寸变了才检查**（滚动 / pinch 平移不改容器尺寸，但会每帧触发
   *    `schedule()`；不设这道闸，`bottom/right` 对齐的浮窗每帧都会被重落位）；
   * 2. 位置用 `floatingLocalBox` 读 —— dockview 拖到容器下半部分会把 `top` 写成 `auto`、
   *    改用 `bottom` 对齐，`parseFloat('auto')` 是 `NaN`，会被误判成「装不下」。
   */
  function reclampFloatingGroups(): void {
    const dockview = instance();
    const container = deps.getContainer();
    if (!dockview || !container) return;
    const box = { width: container.clientWidth, height: container.clientHeight };
    if (!hasUsableSize(box)) return;
    if (isSameSize(lastReclampSize, box)) return;
    lastReclampSize = { width: box.width, height: box.height };
    for (const group of dockview.groups) {
      const bounds = overflowingFloatingBounds(group, container, box, deps);
      if (bounds) dockview.addFloatingGroup(group, bounds);
    }
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
      reclampFloatingGroups();
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
    reclampFloatingGroups,
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
