/**
 * 浮窗（dockview floating group）的**局部几何**工具：把 `.dv-resize-container`
 * 的 inline 定位与尺寸读成容器局部 px。
 *
 * 为什么需要它：dockview 给浮窗写定位时可能在 `left` / `right`（以及 `top` / `bottom`）
 * 之间切换 —— 拖到容器下半部分就改成 `bottom` 对齐，于是 `style.left/top` 是 `'auto'`。
 * `Number.parseFloat('auto')` = `NaN`，直接拿它做「装不装得下」的判断就会把浮窗误判成越界，
 * 每帧重新落位（923 handoff §0 的回归）。这里把两种对齐都还原成局部盒。
 *
 * 统一入口还有第二个好处：拖动（`workspaceFloatingDrag.ts`）与 resize
 * （`workspaceFloatingResize.ts`）用同一套坐标定义，不用各写一遍 `auto` 还原。
 */

/** 容器局部 px 的浮窗盒（`left/top` 永远是有限数）。 */
export interface FloatingLocalBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 把数值夹进 `[min, max]`。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** `parseFloat` 但只接受有限数（`'auto'` / `''` / 乱码都返回 `undefined`）。 */
function finite(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 读浮窗的局部盒。
 *
 * 优先信 inline `left/top`；`auto` 时用 `right/bottom` + 容器尺寸反推
 * （`localLeft = clientWidth - right - width`），最后才退回 `offsetLeft/offsetTop`
 * ——它们都是**局部 px**，`zoom` 不参与（`offsetWidth` / `clientWidth` 同样不受缩放影响）。
 */
export function floatingLocalBox(overlay: HTMLElement, container: HTMLElement): FloatingLocalBox {
  const width = overlay.offsetWidth;
  const height = overlay.offsetHeight;
  const left = finite(overlay.style.left);
  const top = finite(overlay.style.top);
  if (left !== undefined && top !== undefined) return { left, top, width, height };
  const right = finite(overlay.style.right);
  const bottom = finite(overlay.style.bottom);
  return {
    left:
      left ?? (right !== undefined ? container.clientWidth - right - width : overlay.offsetLeft),
    top:
      top ?? (bottom !== undefined ? container.clientHeight - bottom - height : overlay.offsetTop),
    width,
    height,
  };
}
