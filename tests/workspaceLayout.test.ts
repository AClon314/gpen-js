import { describe, expect, test } from "bun:test";
import {
  centeredFloatingBounds,
  COLUMN_MINIMUM_WIDTHS,
  FLOATING_MINIMUM_SIZE,
  MINIMUM_GRID_WIDTH,
  minimumColumnWidths,
} from "../src/lib/components/workspace/workspaceLayout";
import {
  clamp,
  draggedLocalPosition,
  floatingLocalBox,
  isPrimaryPointerPress,
  isUsableZoom,
  resizedLocalBox,
  writeLocalOrigin,
  writeLocalSize,
} from "../src/lib/components/workspace/workspaceFloatingGeometry";

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

/** 伪装的浮窗 / 容器元素：`floatingLocalBox` 只读这几个属性，不需要真 DOM。 */
function fakeOverlay(init: {
  offsetWidth: number;
  offsetHeight: number;
  offsetLeft?: number;
  offsetTop?: number;
  left?: string;
  top?: string;
  right?: string;
  bottom?: string;
}): HTMLElement {
  return {
    offsetWidth: init.offsetWidth,
    offsetHeight: init.offsetHeight,
    offsetLeft: init.offsetLeft ?? 0,
    offsetTop: init.offsetTop ?? 0,
    style: {
      left: init.left ?? "",
      top: init.top ?? "",
      right: init.right ?? "",
      bottom: init.bottom ?? "",
    },
  } as unknown as HTMLElement;
}

function fakeContainer(width: number, height: number): HTMLElement {
  return { clientWidth: width, clientHeight: height } as unknown as HTMLElement;
}

/**
 * 浮窗局部几何：拖动 / resize 的坐标换算。
 *
 * 这段以前一半在 `workspaceFloatingDrag`、一半在 `workspaceFloatingResize`（两个文件
 * 一度互为克隆），现在由 `workspaceFloatingGeometry` 统一实现，所以在这里按纯函数收口。
 */
describe("floating local geometry", () => {
  test("clamp is a plain inclusive clamp", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  test("isUsableZoom only accepts a real, non-unit zoom", () => {
    expect(isUsableZoom(1)).toBe(false);
    expect(isUsableZoom(1.0005)).toBe(false);
    expect(isUsableZoom(2)).toBe(true);
    expect(isUsableZoom(0.5)).toBe(true);
    expect(isUsableZoom(0)).toBe(false);
    expect(isUsableZoom(-1)).toBe(false);
    expect(isUsableZoom(Number.NaN)).toBe(false);
    expect(isUsableZoom(Number.POSITIVE_INFINITY)).toBe(false);
  });

  test("isPrimaryPointerPress only rejects non-left mouse buttons", () => {
    expect(isPrimaryPointerPress({ pointerType: "mouse", button: 0 } as PointerEvent)).toBe(true);
    expect(isPrimaryPointerPress({ pointerType: "mouse", button: 2 } as PointerEvent)).toBe(false);
    expect(isPrimaryPointerPress({ pointerType: "touch", button: 2 } as PointerEvent)).toBe(true);
    expect(isPrimaryPointerPress({ pointerType: "pen", button: 5 } as PointerEvent)).toBe(true);
  });

  test("floatingLocalBox prefers inline left/top", () => {
    const overlay = fakeOverlay({
      offsetWidth: 200,
      offsetHeight: 100,
      left: "30px",
      top: "40px",
      right: "auto",
      bottom: "auto",
    });
    expect(floatingLocalBox(overlay, fakeContainer(800, 600))).toEqual({
      left: 30,
      top: 40,
      width: 200,
      height: 100,
    });
  });

  test("floatingLocalBox reverses auto left/top from right/bottom", () => {
    const overlay = fakeOverlay({
      offsetWidth: 200,
      offsetHeight: 100,
      left: "auto",
      top: "auto",
      right: "50px",
      bottom: "30px",
    });
    expect(floatingLocalBox(overlay, fakeContainer(800, 600))).toEqual({
      left: 800 - 50 - 200,
      top: 600 - 30 - 100,
      width: 200,
      height: 100,
    });
  });

  test("floatingLocalBox falls back to offsets when every alignment is auto", () => {
    const overlay = fakeOverlay({
      offsetWidth: 120,
      offsetHeight: 80,
      offsetLeft: 12,
      offsetTop: 34,
    });
    expect(floatingLocalBox(overlay, fakeContainer(800, 600))).toMatchObject({
      left: 12,
      top: 34,
    });
  });

  test("floatingLocalBox treats unparsable alignment as auto", () => {
    const overlay = fakeOverlay({
      offsetWidth: 120,
      offsetHeight: 80,
      offsetLeft: 7,
      offsetTop: 9,
      left: "wat",
      top: "wat",
    });
    expect(floatingLocalBox(overlay, fakeContainer(800, 600))).toMatchObject({
      left: 7,
      top: 9,
    });
  });

  test("writeLocalOrigin rounds the origin and clears right/bottom", () => {
    const style: Record<string, string> = { right: "10px", bottom: "20px" };
    const overlay = { style } as unknown as HTMLElement;
    writeLocalOrigin(overlay, { left: 10.4, top: 20.6 });
    expect(style).toEqual({ left: "10px", top: "21px", right: "auto", bottom: "auto" });
  });

  test("writeLocalSize rounds the size", () => {
    const style: Record<string, string> = {};
    const overlay = { style } as unknown as HTMLElement;
    writeLocalSize(overlay, { width: 200.5, height: 99.4 });
    expect(style).toEqual({ width: "201px", height: "99px" });
  });

  test("dragging moves the box by the pointer delta at zoom 1", () => {
    expect(
      draggedLocalPosition(
        { left: 100, top: 100 },
        { x: 10, y: 20 },
        1,
        { width: 800, height: 600 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ left: 110, top: 120 });
  });

  test("dragging divides the visual delta by zoom", () => {
    // 视觉 40px 在 zoom 2 下是局部 20px。
    expect(
      draggedLocalPosition(
        { left: 100, top: 100 },
        { x: 40, y: 40 },
        2,
        { width: 800, height: 600 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ left: 120, top: 120 });
  });

  test("dragging clamps to both container edges", () => {
    const size = { width: 300, height: 200 };
    const container = { width: 800, height: 600 };
    expect(
      draggedLocalPosition({ left: 100, top: 100 }, { x: -500, y: -500 }, 1, container, size),
    ).toEqual({ left: 0, top: 0 });
    expect(
      draggedLocalPosition({ left: 100, top: 100 }, { x: 900, y: 900 }, 1, container, size),
    ).toEqual({ left: 500, top: 400 });
  });

  test("dragging a box larger than the container collapses to the origin", () => {
    expect(
      draggedLocalPosition(
        { left: 50, top: 50 },
        { x: 10, y: 10 },
        1,
        { width: 100, height: 100 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ left: 0, top: 0 });
  });

  const BASE = { left: 100, top: 100, width: 200, height: 150 };
  const CONTAINER = { width: 800, height: 600 };

  test("resizing from the right grows while the left edge stays put", () => {
    expect(resizedLocalBox(BASE, "right", { x: 60, y: 0 }, CONTAINER)).toEqual({
      left: 100,
      top: 100,
      width: 260,
      height: 150,
    });
  });

  test("resizing from the left moves the left edge and keeps the right", () => {
    // 右边界 300；`left` 夹到 `right - minWidth = 60`。
    expect(resizedLocalBox(BASE, "left", { x: 50, y: 0 }, CONTAINER)).toEqual({
      left: 60,
      top: 100,
      width: 240,
      height: 150,
    });
    expect(resizedLocalBox(BASE, "left", { x: -500, y: 0 }, CONTAINER)).toEqual({
      left: 0,
      top: 100,
      width: 300,
      height: 150,
    });
  });

  test("resizing from the top moves the top edge and keeps the bottom", () => {
    expect(resizedLocalBox(BASE, "top", { x: 0, y: -30 }, CONTAINER)).toEqual({
      left: 100,
      top: 50,
      width: 200,
      height: 200,
    });
  });

  test("resizing from the bottom never goes below the minimum height", () => {
    expect(resizedLocalBox(BASE, "bottom", { x: 0, y: -500 }, CONTAINER)).toEqual({
      left: 100,
      top: 100,
      width: 200,
      height: FLOATING_MINIMUM_SIZE.height,
    });
  });

  test("resizing stays inside the container", () => {
    expect(resizedLocalBox(BASE, "bottom", { x: 0, y: 900 }, CONTAINER)).toEqual({
      left: 100,
      top: 100,
      width: 200,
      height: 600 - 100,
    });
    expect(resizedLocalBox(BASE, "right", { x: 900, y: 0 }, CONTAINER)).toEqual({
      left: 100,
      top: 100,
      width: 800 - 100,
      height: 150,
    });
  });

  test("a corner handle moves both axes", () => {
    expect(resizedLocalBox(BASE, "topleft", { x: -50, y: -50 }, CONTAINER)).toEqual({
      left: 50,
      top: 50,
      width: 250,
      height: 200,
    });
  });

  test("a vertical-only handle leaves width and left untouched (and vice versa)", () => {
    expect(resizedLocalBox(BASE, "top", { x: 999, y: 0 }, CONTAINER)).toMatchObject({
      left: BASE.left,
      width: BASE.width,
    });
    expect(resizedLocalBox(BASE, "right", { x: 0, y: 999 }, CONTAINER)).toMatchObject({
      top: BASE.top,
      height: BASE.height,
    });
  });
});
