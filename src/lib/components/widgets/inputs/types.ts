import type { HTMLInputAttributes } from "svelte/elements";

export type InputValue = number | string;
export type InputOrientation = "horizontal" | "vertical";

/**
 * 分发壳与 InputNumber 共用的 props 形状。
 * 除 `value` 外的原生属性直接继承 `HTMLInputAttributes`（`aria-label` 就是可见标签的替代），
 * 下面几个是只有自研分支会消费的扩展项，原生分支会忽略它们。
 *
 * `step` 同时承担两个职责：`±` / 拖拽 / caret 贴边时 ←/→ 的步长，以及提交时的取整位数
 * （步长的十进制位数，如 `0.2` → 1 位、`30` → 整数）。不再有独立的 `precision`。
 */
export interface InputProps extends Omit<HTMLInputAttributes, "value"> {
  value?: InputValue;
  /** 数值分支：横向 / 纵向布局 */
  orientation?: InputOrientation;
  /** 数值分支：输入框旁可见的单位（% / px …），同时并入 aria-valuetext */
  unit?: string;
}
