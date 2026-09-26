/**
 * Workspace column minimums — the pure half of the dockview layout policy.
 *
 * `buildDefaultLayout` declares desktop minimums for the three columns
 * (tools 52 + viewport 240 + side 160 = 452). Dockview *honours* those
 * minimums by growing the grid past its container when the container is
 * narrower: every group then gets a right edge outside the viewport, so the
 * top bar's action buttons and the whole `场景集合 / 属性` column are on
 * screen and yet unreachable — the exact symptom "看的见边框、点不到控件".
 *
 * A phone in portrait is ~360ch, so this fires on every phone. The policy:
 *
 * - container ≥ 452ch: do nothing at all (desktop behaviour is untouched);
 * - narrower: take the width out of the **viewport** first. The canvas is
 *   elastic — any width still draws — while the properties panel is not: its
 *   numeric rows need their minimum or they clip;
 * - narrower than the chrome minimums themselves (< 212ch, i.e. a very narrow
 *   docked panel): scale chrome down too. Three cramped columns beat a UI cut
 *   off at the container edge.
 *
 * Kept as plain functions (`bun test`) so the policy can be checked without a
 * browser; `GpenWorkspace` only pushes the result into
 * `group.api.setConstraints` / `addPanel({ floating })`.
 */

/** Container / panel sizes as plain numbers, so the policy stays DOM-free. */
export interface LayoutSize {
  width: number;
  height: number;
}

/** A non-negative, finite size number (dockview reports NaN before its first layout). */
function positive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Desktop minimums, used by `buildDefaultLayout` for `tools` / `viewport` / `outliner`. */
export const COLUMN_MINIMUM_WIDTHS = { tools: 52, viewport: 240, side: 160 } as const;

/** The narrowest container that can honour all three desktop minimums. */
export const MINIMUM_GRID_WIDTH =
  COLUMN_MINIMUM_WIDTHS.tools + COLUMN_MINIMUM_WIDTHS.viewport + COLUMN_MINIMUM_WIDTHS.side;

/** 三列（工具 / 视口 / 侧栏）的最小宽度。 */
export interface ColumnMinimumWidths {
  tools: number;
  viewport: number;
  side: number;
}

/**
 * Column minimums for a container `available` ch wide. The three always sum to
 * at most `available`, so the grid can never be forced wider than its box.
 */
export function minimumColumnWidths(available: number): ColumnMinimumWidths {
  const { tools, viewport, side } = COLUMN_MINIMUM_WIDTHS;
  const width = positive(available);
  if (width >= MINIMUM_GRID_WIDTH) return { tools, viewport, side };

  const chrome = tools + side;
  const chromeScale = width >= chrome ? 1 : width / chrome;
  const toolsMin = Math.round(tools * chromeScale);
  const sideMin = Math.round(side * chromeScale);
  return { tools: toolsMin, viewport: Math.round(width) - toolsMin - sideMin, side: sideMin };
}

/**
 * A floating panel narrower / shorter than this is not usable, so ask for at
 * least this much and let dockview's `boundedWithinViewport` trim it back.
 */
export const FLOATING_MINIMUM_SIZE = { width: 240, height: 200 } as const;

/** 浮窗在容器内的坐标与尺寸。 */
export interface FloatingBounds extends LayoutSize {
  x: number;
  y: number;
}

/**
 * Where a floating panel goes: preferred size shrunk to fit the container with
 * `margin` on every side, then centered.
 *
 * `addPanel({ floating })` has no `'center'` anchor (`FloatingGroupOptions.position`
 * is `AnchorPosition`: four corners only), so the coordinates are ours to compute.
 *
 * Both clamps are load-bearing even though dockview has
 * `floatingGroupBounds: 'boundedWithinViewport'`: that option bounds a float the
 * *user* drags, but an oversized initial request is placed as-is. Ablation: drop
 * the clamps and a 420×520 panel in a 560×460 container lands at y=27 with its
 * bottom edge 59px below the viewport, and in 360×340 it covers the screen
 * off-center instead of sitting at (17,43) with a 16px margin.
 *
 * Known gap (not this function's job): a float that is already open is not
 * re-bounded when the container shrinks or when a stored layout is restored —
 * dockview only bounds drags. See `docs/panel.md`.
 */
export function centeredFloatingBounds(
  container: LayoutSize,
  preferred: LayoutSize,
  margin: number,
): FloatingBounds {
  const gap = positive(margin);
  const available = { width: positive(container.width), height: positive(container.height) };
  const width = Math.min(
    preferred.width,
    Math.max(FLOATING_MINIMUM_SIZE.width, available.width - 2 * gap),
  );
  const height = Math.min(
    preferred.height,
    Math.max(FLOATING_MINIMUM_SIZE.height, available.height - 2 * gap),
  );
  return {
    x: Math.max(gap, Math.round((available.width - width) / 2)),
    y: Math.max(gap, Math.round((available.height - height) / 2)),
    width,
    height,
  };
}
