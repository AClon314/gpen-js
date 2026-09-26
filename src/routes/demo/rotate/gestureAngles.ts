/**
 * 视图旋转 demo 的纯几何：不碰 DOM，也不碰 Svelte runes。
 *
 * 两指旋转只关心「前后两次两指连线角度之差」；把换算单独放这里，页面里的
 * 触摸状态机才只剩「记住触点 → 取连线 → 累加角度」三件事。
 */

export type Point = {
  x: number;
  y: number;
};

/** 快捷角度按钮的固定选项。 */
export const QUICK_ANGLES = [0, 90, 180, 270] as const;

/** 视图旋转角固定落在 [0, 360]；非有限值按 0 处理。 */
export function clampAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(360, Math.max(0, value));
}

/** 把任意角度折算回 [0, 360)。 */
export function wrapAngle(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** 两指连线相对屏幕 x 轴的角度（度）。 */
export function lineAngle([first, second]: [Point, Point]): number {
  return (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI;
}

/** 将两次测量之间的差值压到 [-180, 180]，避免跨过 0° 时跳变一整圈。 */
export function shortestAngleDelta(next: number, previous: number): number {
  let delta = next - previous;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}
