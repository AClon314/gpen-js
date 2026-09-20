import { describe, expect, test } from "bun:test";
import {
  COLUMN_MINIMUM_WIDTHS,
  MINIMUM_GRID_WIDTH,
  minimumColumnWidths,
} from "../src/lib/components/workspaceLayout";

describe("workspace column minimums", () => {
  test("the desktop minimums are the ones buildDefaultLayout declares", () => {
    expect(COLUMN_MINIMUM_WIDTHS).toEqual({ tools: 52, viewport: 240, side: 160 });
    expect(MINIMUM_GRID_WIDTH).toBe(452);
  });

  test("at or above the grid minimum nothing is touched", () => {
    expect(minimumColumnWidths(MINIMUM_GRID_WIDTH)).toEqual(COLUMN_MINIMUM_WIDTHS);
    expect(minimumColumnWidths(1280)).toEqual(COLUMN_MINIMUM_WIDTHS);
  });

  test("a phone-width container squeezes the viewport, not the panels", () => {
    // 360ch is an iPhone-class portrait width.
    const narrow = minimumColumnWidths(360);
    expect(narrow.tools).toBe(52);
    expect(narrow.side).toBe(160);
    expect(narrow.viewport).toBe(360 - 52 - 160);
  });

  test("the three columns always add up to the container width", () => {
    // This is the property that matters: dockview grows the grid past its
    // container when the minimums do not fit, and a grid wider than its box
    // puts the right-hand edge (and its buttons) outside the viewport.
    for (const width of [0, 1, 100, 211, 212, 213, 320, 360, 400, 451, 452, 453, 900]) {
      const columns = minimumColumnWidths(width);
      expect(columns.tools + columns.viewport + columns.side).toBeLessThanOrEqual(width);
      expect(columns.viewport).toBeGreaterThanOrEqual(0);
      expect(columns.tools).toBeGreaterThanOrEqual(0);
      expect(columns.side).toBeGreaterThanOrEqual(0);
    }
  });

  test("below the chrome minimums the chrome scales down too", () => {
    const cramped = minimumColumnWidths(200);
    expect(cramped.tools).toBeLessThan(COLUMN_MINIMUM_WIDTHS.tools);
    expect(cramped.side).toBeLessThan(COLUMN_MINIMUM_WIDTHS.side);
    expect(cramped.viewport).toBe(0);
    expect(cramped.tools + cramped.side).toBeLessThanOrEqual(200);
  });

  test("a nonsensical width clamps instead of producing NaN", () => {
    expect(minimumColumnWidths(Number.NaN)).toEqual({ tools: 0, viewport: 0, side: 0 });
    expect(minimumColumnWidths(-40)).toEqual({ tools: 0, viewport: 0, side: 0 });
  });
});
