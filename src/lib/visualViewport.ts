/**
 * 视觉视口（`visualViewport`）读取与订阅。DOM 只在这里碰一次，其余模块从这里拿。
 *
 * 为什么要有这一层：同一个页面坐标系问题在 4 个地方出现 —— overlay 的定位、悬浮球的拖拽、
 * 视口小地图、工作区尺寸测量 —— 每个地方都各自 `window.visualViewport?.width ?? innerWidth`
 * 加四个事件监听，错一个就出现"手机上元素被固定在看不见的地方"这类问题。
 *
 * 三种坐标，别混：
 * - **视觉视口坐标**：相对 `visualViewport` 左上角，即用户实际看到的位置
 *   （pinch 放大 + 平移后，它和布局视口坐标相差 `viewportOffset()`）；
 * - **布局视口坐标**：`getBoundingClientRect()` / `clientX` 用的坐标系；
 * - **文档坐标**：`position: absolute` 的 `left/top` 用的坐标系，差 `pageOffset()`。
 */

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportPosition {
  x: number;
  y: number;
}

/** 视觉视口在**文档坐标**里的矩形（`pageTop/pageLeft` 已含页面滚动与 pinch 平移）。 */
export interface ViewportRect extends ViewportSize {
  top: number;
  left: number;
}

/** 当前 `visualViewport`；拿不到时返回 null（非浏览器环境 / 老浏览器）。 */
export function visualViewport(): VisualViewport | null {
  return typeof window === "undefined" ? null : (window.visualViewport ?? null);
}

/** 缩放比例：pinch / 浏览器缩放后 > 1（`visualViewport.scale` 未实现时为 1）。 */
export function viewportZoom(viewport: VisualViewport | null = visualViewport()): number {
  return viewport?.scale ?? 1;
}

/** 可视区尺寸；优先 `visualViewport`，pinch 缩放与软键盘都能反映。 */
export function viewportSize(viewport: VisualViewport | null = visualViewport()): ViewportSize {
  return {
    width: viewport?.width ?? (typeof window === "undefined" ? 0 : window.innerWidth),
    height: viewport?.height ?? (typeof window === "undefined" ? 0 : window.innerHeight),
  };
}

/** 视觉视口相对**布局视口**的偏移：`position: fixed` 的元素要补它。未缩放时是 (0, 0)。 */
export function viewportOffset(
  viewport: VisualViewport | null = visualViewport(),
): ViewportPosition {
  return { x: viewport?.offsetLeft ?? 0, y: viewport?.offsetTop ?? 0 };
}

/** 视觉视口相对**文档原点**的偏移：`position: absolute` 的元素要补它。 */
export function pageOffset(viewport: VisualViewport | null = visualViewport()): ViewportPosition {
  return {
    x: viewport?.pageLeft ?? (typeof window === "undefined" ? 0 : window.scrollX),
    y: viewport?.pageTop ?? (typeof window === "undefined" ? 0 : window.scrollY),
  };
}

/** 视觉视口在文档坐标里的矩形：绝对定位的浮层直接拿它当 `top/left/width/height`。 */
export function viewportRect(viewport: VisualViewport | null = visualViewport()): ViewportRect {
  const size = viewportSize(viewport);
  const offset = pageOffset(viewport);
  return { top: offset.y, left: offset.x, width: size.width, height: size.height };
}

/** 视觉视口坐标 → 任一参考系坐标（只差一个偏移）。 */
export function offsetPosition(
  position: ViewportPosition,
  offset: ViewportPosition,
): ViewportPosition {
  return { x: position.x + offset.x, y: position.y + offset.y };
}

/**
 * 订阅"可视区变化"：`window` 与 `visualViewport` 的 resize / scroll 合成一次回调，
 * 并用 rAF 合并同帧内的多次触发（pinch 平移时 scroll 每帧都发）。
 * 返回取消订阅函数。
 */
export function observeViewport(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  let frame: number | undefined;
  const schedule = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      callback();
    });
  };

  const targets: (Window | VisualViewport)[] = [window];
  const viewport = visualViewport();
  if (viewport) targets.push(viewport);
  for (const target of targets) {
    target.addEventListener("resize", schedule, { passive: true });
    target.addEventListener("scroll", schedule, { passive: true });
  }

  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const target of targets) {
      target.removeEventListener("resize", schedule);
      target.removeEventListener("scroll", schedule);
    }
  };
}
