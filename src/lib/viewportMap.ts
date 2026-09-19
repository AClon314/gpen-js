/**
 * 小地图（MiniMap）的投影数学：把"文档里的一块可见区域"映射成"小地图里的一格"，
 * 以及把"小地图上的一点"反解回"视图应该滚到哪里"。
 *
 * DOM / Svelte 无关，纯函数，便于单测（见 tests/viewportMap.test.ts）。
 *
 * 约定：
 * - 所有尺寸 / 坐标都是**文档坐标**的 CSS px；
 * - 小地图覆盖的范围（span）边长 = 视图尺寸 × factor，再夹到文档范围内；
 * - span 的原点**对齐到一个 span 网格**（`floor(中心 / span) * span`），而不是每帧
 *   跟着视图滑动。否则视图框会永远钉在正中央，拖动时看不到任何反馈；对齐到网格后
 *   框会在地图里真的走动，跨格时地图重新对中；
 * - 归一化点 `(nx, ny)` 的 (0,0) 是小地图的左上角、(1,1) 是右下角，
 *   两个轴各按自己的比例换算，因此小地图画成什么宽高比都不影响拖拽的正确性。
 */

export interface MapSize {
  width: number;
  height: number;
}

export interface MapRect extends MapSize {
  x: number;
  y: number;
}

/** 小地图覆盖范围 = 视图尺寸 × 该倍数；越大看得越远、视图框越小。 */
export const MINIMAP_SPAN_FACTOR = 4;

/** 一次投影的输入：文档总范围 + 当前可见区域。 */
export interface MinimapInput {
  /** 被映射的总范围（滚动范围 / 画布范围）。 */
  extent: MapSize;
  /** 当前可见区域（文档坐标）。 */
  viewport: MapRect;
  factor?: number;
}

/** 投影结果：地图原点（文档坐标）、覆盖范围、以及视图在地图里的相对位置（0..1）。 */
export interface MinimapProjection {
  origin: { x: number; y: number };
  span: MapSize;
  /** 视图矩形在地图里的相对位置与大小，四个值都是 0..1。 */
  rect: MapRect;
}

function clamp(value: number, lower: number, upper: number): number {
  if (!Number.isFinite(value)) return lower;
  return Math.min(Math.max(value, lower), Math.max(lower, upper));
}

/** 把视图左上角夹进文档范围（文档比视图还小时会退回 0）。 */
export function clampViewportOrigin(origin: { x: number; y: number }, input: MinimapInput) {
  return {
    x: clamp(origin.x, 0, input.extent.width - input.viewport.width),
    y: clamp(origin.y, 0, input.extent.height - input.viewport.height),
  };
}

export function projectMinimap(input: MinimapInput): MinimapProjection {
  const factor = input.factor ?? MINIMAP_SPAN_FACTOR;
  const { extent, viewport } = input;
  const span: MapSize = {
    width: Math.min(Math.max(extent.width, 0), Math.max(viewport.width, 0) * factor),
    height: Math.min(Math.max(extent.height, 0), Math.max(viewport.height, 0) * factor),
  };
  const center = {
    x: viewport.x + viewport.width / 2,
    y: viewport.y + viewport.height / 2,
  };
  const anchor = (value: number, step: number, limit: number) => {
    if (step <= 0) return 0;
    return clamp(Math.floor(value / step) * step, 0, limit);
  };
  const origin = {
    x: anchor(center.x, span.width, extent.width - span.width),
    y: anchor(center.y, span.height, extent.height - span.height),
  };
  const rect: MapRect = {
    x: span.width > 0 ? (viewport.x - origin.x) / span.width : 0,
    y: span.height > 0 ? (viewport.y - origin.y) / span.height : 0,
    width: span.width > 0 ? viewport.width / span.width : 1,
    height: span.height > 0 ? viewport.height / span.height : 1,
  };
  return { origin, span, rect };
}

/**
 * 把地图上的归一化点翻译成"视图应该摆在哪"：让视图中心落在该点对应的文档位置上，
 * 再夹进文档范围（浏览器自己也会夹 scrollTo，这里夹一次是为了可测）。
 */
export function viewportOriginAtPoint(input: MinimapInput & { nx: number; ny: number }): {
  x: number;
  y: number;
} {
  const { origin, span } = projectMinimap(input);
  const point = {
    x: origin.x + clamp(input.nx, 0, 1) * span.width,
    y: origin.y + clamp(input.ny, 0, 1) * span.height,
  };
  return clampViewportOrigin(
    {
      x: point.x - input.viewport.width / 2,
      y: point.y - input.viewport.height / 2,
    },
    input,
  );
}
