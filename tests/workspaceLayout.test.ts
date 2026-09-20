import { describe, expect, test } from "bun:test";
import {
  centeredFloatingBounds,
  COLUMN_MINIMUM_WIDTHS,
  FLOATING_MINIMUM_SIZE,
  MINIMUM_GRID_WIDTH,
  minimumColumnWidths,
} from "../src/lib/components/workspaceLayout";

describe("workspace column minimums", () => {
  test("the desktop minimums are the values buildDefaultLayout asks dockview for", () => {
    // `buildDefaultLayout` 直接引用这三个常量，所以改这里等于改默认布局的声明。
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

/**
 * 浮动面板几何（偏好设置面板的落点）。
 *
 * 这段以前写在 `GpenWorkspace.openPreferences()` 里，一个断言都没有：消融（去掉夹取、
 * 只把 420×520 和未夹取的居中坐标交给 dockview）能跑绿全部测试，但实测面板会溢出视口
 * ——560×460 时下边缘到 519，360×340 时铺满到 418×492 @ (1,27)。这里就是补那条缺口。
 */
describe("centered floating bounds", () => {
  const PREFERRED = { width: 420, height: 520 };
  const MARGIN = 16;

  test("centers the preferred size when there is room", () => {
    expect(centeredFloatingBounds({ width: 1280, height: 720 }, PREFERRED, MARGIN)).toEqual({
      x: 430,
      y: 100,
      width: 420,
      height: 520,
    });
  });

  test("shrinks to leave the margin on every side", () => {
    // 560×460（实测过的那一档）：宽度装得下，高度要收到 460 - 2*16。
    expect(centeredFloatingBounds({ width: 560, height: 460 }, PREFERRED, MARGIN)).toEqual({
      x: 70,
      y: 16,
      width: 420,
      height: 428,
    });
  });

  test("never requests a float smaller than the usable minimum", () => {
    // 容器比最小可用尺寸还小时不把面板缩到不能看：先请求最小尺寸，
    // 再让 dockview 的 `boundedWithinViewport` 去夹（那是它的职责）。
    const bounds = centeredFloatingBounds({ width: 200, height: 150 }, PREFERRED, MARGIN);
    expect(bounds.width).toBe(FLOATING_MINIMUM_SIZE.width);
    expect(bounds.height).toBe(FLOATING_MINIMUM_SIZE.height);
    expect(bounds.x).toBe(MARGIN);
    expect(bounds.y).toBe(MARGIN);
  });

  test("keeps the margin whenever the container has room for it", () => {
    for (const width of [360, 400, 480, 560, 800, 1280]) {
      for (const height of [340, 460, 720, 1080]) {
        const bounds = centeredFloatingBounds({ width, height }, PREFERRED, MARGIN);
        expect(bounds.x).toBeGreaterThanOrEqual(MARGIN);
        expect(bounds.y).toBeGreaterThanOrEqual(MARGIN);
        if (width >= PREFERRED.width + 2 * MARGIN) {
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - MARGIN + 1);
        }
        if (height >= PREFERRED.height + 2 * MARGIN) {
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - MARGIN + 1);
        }
      }
    }
  });

  test("a container that is not laid out yet does not produce NaN", () => {
    // 容器还没量出来（NaN / 0）时退到最小可用尺寸 + 边距，而不是拿 NaN 去 addPanel。
    const bounds = centeredFloatingBounds({ width: Number.NaN, height: 0 }, PREFERRED, MARGIN);
    expect(bounds).toEqual({
      x: MARGIN,
      y: MARGIN,
      width: FLOATING_MINIMUM_SIZE.width,
      height: FLOATING_MINIMUM_SIZE.height,
    });
    expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
  });

  test("a zero margin still hugs the edges instead of going negative", () => {
    const bounds = centeredFloatingBounds({ width: 200, height: 200 }, PREFERRED, 0);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
  });
});
