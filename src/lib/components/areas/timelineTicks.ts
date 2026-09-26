/**
 * Timeline 组件的刻度与坐标换算（无 DOM / 无 Svelte，可在 `bun test` 里断言）。
 *
 * 标尺上一列 = `framesPerTick` 帧、宽为 CSS 变量 `--frame-width`；关键帧与播放头
 * 都用同一个「帧号 → 列偏移」换算，所以三者始终在同一坐标系里。抽出来之后组件
 * 模板只负责渲染（见 tests/timeline.test.ts）。
 */

/** 标尺上每个刻度的帧号：从 `startFrame` 起，每 `framesPerTick` 帧一个刻度。 */
export function timelineTickFrames(count: number, framesPerTick: number, startFrame = 1): number[] {
  return Array.from({ length: count }, (_, index) => startFrame + index * framesPerTick);
}

/**
 * 帧号 → 帧网格里的左偏移 CSS 值。
 *
 * `frameWidth` 缺省是组件的列宽变量 `--frame-width`；显式传入时（例如测试里用具体
 * 长度）也能得到可读的 `calc()` 字符串。
 */
export function frameGridLeft(
  frame: number,
  firstFrame: number,
  frameWidth = "var(--frame-width)",
): string {
  return `calc(${frame - firstFrame} * ${frameWidth})`;
}
