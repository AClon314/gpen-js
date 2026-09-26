/**
 * 右键菜单的几何层（纯函数，无 Svelte / 无 DOM）。
 *
 * 菜单定位分两段：打开时按指针坐标或锚点矩形算一个初始位置，元素渲染后再按
 * **视觉**尺寸夹进视口（`contextMenu.svelte.ts` 的 `clampMenuPosition`）。两段都
 * 只做算术，视口尺寸由调用方从 `visualViewport` 读入，所以四角、视口过小这些
 * 边界可以在 `tests/menuPosition.test.ts` 里直接构造，不必开浏览器。
 *
 * 坐标一律是**视觉 px**（`getBoundingClientRect()` / `clientX` 的坐标系），
 * 与菜单内部吃的 `zoom` 无关：调用方负责把尺寸量成视觉 px（见 `workspaceZoom.ts`）。
 */

/** 菜单与视口边缘之间留出的缝隙（视觉 px）。 */
export const MENU_MARGIN_PX = 8;

/** 一个视口或菜单矩形的宽高（视觉 px）。 */
export interface MenuSize {
  width: number;
  height: number;
}

/** 一个点（client / 视觉 px）。 */
export interface MenuPoint {
  x: number;
  y: number;
}

/** 一个矩形在视口坐标里的四边（`getBoundingClientRect()` 的视觉 px）。 */
export interface MenuRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 把一个坐标夹进 `[MENU_MARGIN_PX, viewport - size - MENU_MARGIN_PX]`。
 *
 * `viewport <= 0`（拿不到视口）时只保证不小于边距：宁可露出一点，也不要把
 * 菜单推到负坐标里完全看不见。尺寸取 `max(0, size)`，负尺寸视为 0。
 */
export function clampMenuCoordinate(value: number, size: number, viewport: number): number {
  const coordinate = Number.isFinite(value) ? value : MENU_MARGIN_PX;
  if (viewport <= 0) return Math.max(MENU_MARGIN_PX, coordinate);
  const maximum = Math.max(MENU_MARGIN_PX, viewport - Math.max(0, size) - MENU_MARGIN_PX);
  return Math.min(Math.max(MENU_MARGIN_PX, coordinate), maximum);
}

/** 把菜单左上角夹进视口；`size` 是菜单的视觉尺寸（含 `zoom` 与子菜单）。 */
export function clampMenuPoint(point: MenuPoint, size: MenuSize, viewport: MenuSize): MenuPoint {
  return {
    x: clampMenuCoordinate(point.x, size.width, viewport.width),
    y: clampMenuCoordinate(point.y, size.height, viewport.height),
  };
}

/**
 * 锚定按钮的菜单纵向位置：默认放在按钮下方 `gap` 处；下方放不下（估算高度会
 * 越过视口底边）时翻到按钮上方，并保证不小于上边距。
 *
 * `estimatedHeight` 是渲染前的估算值；真实尺寸已知后由 `clampMenuPoint` 修正。
 */
export function anchoredMenuTop(
  anchorTop: number,
  anchorBottom: number,
  estimatedHeight: number,
  gap: number,
  viewportHeight: number,
): number {
  const below = anchorBottom + gap;
  if (below + estimatedHeight <= viewportHeight) return below;
  return Math.max(MENU_MARGIN_PX, anchorTop - gap - estimatedHeight);
}

/** 子菜单相对锚点的翻转结果：`horizontal` 放到左侧，`vertical` 底对齐锚点。 */
export interface SubmenuFlip {
  horizontal: boolean;
  vertical: boolean;
}

/** 判断子菜单是否越过视口右边 / 下边，需要翻回锚点另一侧。 */
export function submenuFlip(rect: MenuRect, viewport: MenuSize): SubmenuFlip {
  return {
    horizontal: rect.right > viewport.width - MENU_MARGIN_PX,
    vertical: rect.bottom > viewport.height - MENU_MARGIN_PX,
  };
}
