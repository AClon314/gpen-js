import { expect, type Page } from "playwright/test";

/**
 * 画布（`canvas.stroke-surface`）上的公共指针操作与像素统计。
 *
 * - `countInkPixels` 以前在 `preferences.e2e.ts`、`eraser.e2e.ts`、`stroke.e2e.ts`
 *   各抄一份（实现相同，只有命名不同：`countInk` / `countInkPixels`）。
 * - `dragOnCanvas` 收拢三份「在画布上拖一笔」的编排：`eraser.e2e.ts` 的
 *   `drawLine` / `eraseAlong` 与 `stroke.e2e.ts` 的 `drawStroke`。差异只在插值步数
 *   （6 / 8）、抬手后的静置时间（150 / 250 / 0ms）以及是否给端点 x 加像素偏移
 *   （`drawStroke` 靠它画三条不重叠的笔画）——都作为 options 参数化了。
 */

/** 画布上的相对坐标：两个分量都是相对画布可视矩形的比例（0~1）。 */
export type CanvasPoint = [number, number];

/**
 * 画布 backing store 里非透明（alpha > 0）的像素数。
 *
 * 找不到画布或 2d context 时返回 -1（和抽出前各份实现一致，便于断言「还没打开工作区」）。
 */
export function countInkPixels(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.stroke-surface");
    if (!canvas) return -1;
    const context = canvas.getContext("2d");
    if (!context) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] > 0) count += 1;
    return count;
  });
}

/**
 * 在画布上从 `from` 拖到 `to`（相对坐标），中途在两点正中插一段。
 *
 * - `steps`：两段 `mouse.move` 的插值步数（分步子走是因为 pointer capture 在确认拖拽
 *   >4px 之后才申请，一步跨出控件会丢掉后续 move）。
 * - `settle`：抬手后的静置毫秒数（> 0 才等）。
 * - `offsetPx`：两个端点 x 都加的像素偏移。
 */
export async function dragOnCanvas(
  page: Page,
  from: CanvasPoint,
  to: CanvasPoint,
  options: { steps?: number; settle?: number; offsetPx?: number } = {},
) {
  const { steps = 8, settle = 0, offsetPx = 0 } = options;
  const box = await page.locator("canvas.stroke-surface").boundingBox();
  expect(box).not.toBeNull();
  const x = (t: number) => box!.x + box!.width * t + offsetPx;
  const y = (t: number) => box!.y + box!.height * t;
  await page.mouse.move(x(from[0]), y(from[1]));
  await page.mouse.down();
  await page.mouse.move(x((from[0] + to[0]) / 2), y((from[1] + to[1]) / 2), { steps });
  await page.mouse.move(x(to[0]), y(to[1]), { steps });
  await page.mouse.up();
  if (settle > 0) await page.waitForTimeout(settle);
}
