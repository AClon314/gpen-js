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
 * `group.api.setConstraints`.
 */

/** Desktop minimums, mirroring the `minimumWidth`s in `buildDefaultLayout`. */
export const COLUMN_MINIMUM_WIDTHS = { tools: 52, viewport: 240, side: 160 } as const;

/** The narrowest container that can honour all three desktop minimums. */
export const MINIMUM_GRID_WIDTH =
  COLUMN_MINIMUM_WIDTHS.tools + COLUMN_MINIMUM_WIDTHS.viewport + COLUMN_MINIMUM_WIDTHS.side;

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
  const width = Math.max(0, Number.isFinite(available) ? available : 0);
  if (width >= MINIMUM_GRID_WIDTH) return { tools, viewport, side };

  const chrome = tools + side;
  const chromeScale = width >= chrome ? 1 : width / chrome;
  const toolsMin = Math.round(tools * chromeScale);
  const sideMin = Math.round(side * chromeScale);
  return { tools: toolsMin, viewport: Math.round(width) - toolsMin - sideMin, side: sideMin };
}
