/**
 * 工作区缩放（`uiScale / 外部缩放`）的全局出口：写在根元素上的 CSS 变量。
 *
 * 为什么需要它：右键菜单挂在根 layout（`+layout.svelte` 的 `<ContextMenu />`），
 * **不在** `.dockview-container` 子树里，拿不到那句 `style:zoom={workspaceZoom}`。
 * 把当前缩放写成一个 CSS 变量之后，菜单用纯 CSS 就能跟上
 * （`zoom: var(--gpen-workspace-zoom, 1)`），JS 只剩两处：写变量、按变量估算尺寸。
 *
 * 变量写在 `themeTarget()` 上（网页是 `<html>`，embed 是 ShadowHost），和主题 token
 * 同一个目标——菜单与工作区 chrome 才能落在同一套缩放里。
 *
 * 实测（Chromium，`zoom: 2`）：
 *
 * - `zoom` 会把元素**自己声明的** `left/top` 一起放大 → 菜单本体不能直接吃坐标，
 *   所以 DOM 上是「不缩放的定位壳 + 缩放的菜单」两层（见 `ContextMenu.svelte`）；
 * - `zoom: var(--z)` 生效 → 整条链路可以只有 CSS，不需要 Svelte 状态；
 * - `offsetWidth` 是未缩放的局部 px，`getBoundingClientRect()` 是视觉 px → 夹取
 *   一律用后者，夹取逻辑就不需要知道 zoom（见 `clampMenuPosition`）。
 */
import { themeTarget } from "../themes/theme.svelte";

export const WORKSPACE_ZOOM_VARIABLE = "--gpen-workspace-zoom";

/** 工作区关闭 / 未挂载时的缩放（菜单按 1× 渲染）。 */
export const WORKSPACE_ZOOM_DEFAULT = 1;

/** 把当前缩放写到根元素上（`GpenWorkspace` 的 zoom effect 每次变化都调一次）。 */
export function setWorkspaceZoomVariable(zoom: number): void {
  const target = themeTarget();
  if (!target) return;
  const value = Number.isFinite(zoom) && zoom > 0 ? zoom : WORKSPACE_ZOOM_DEFAULT;
  if (value === WORKSPACE_ZOOM_DEFAULT) target.style.removeProperty(WORKSPACE_ZOOM_VARIABLE);
  else target.style.setProperty(WORKSPACE_ZOOM_VARIABLE, String(value));
}

/**
 * 读当前缩放（CSS 变量解析失败时回落到 1）。
 *
 * 只给「渲染前就要知道尺寸」的地方用：`openAt()` 判断菜单要不要翻到锚点上方时
 * 得把条目数换算成视觉 px（条目高度是局部 px）。
 */
export function readWorkspaceZoomVariable(): number {
  const target = themeTarget();
  if (!target) return WORKSPACE_ZOOM_DEFAULT;
  const raw = getComputedStyle(target).getPropertyValue(WORKSPACE_ZOOM_VARIABLE);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : WORKSPACE_ZOOM_DEFAULT;
}
