import type { HTMLInputAttributes } from "svelte/elements";

import type { Dimension, Registry } from "#lib/inputs/units";

export type InputValue = number | string;
export type InputOrientation = "horizontal" | "vertical";

/**
 * 分发壳与 InputNumber 共用的 props 形状。
 * 除 `value` 外的原生属性直接继承 `HTMLInputAttributes`（`aria-label` 就是可见标签的替代），
 * 下面几个是只有自研分支会消费的扩展项，原生分支会忽略它们。
 *
 * `step` 是唯一的步进量：`±` / 拖拽 / caret 贴边时的 ←/→ / 滑条中央分区都按它走，
 * 缺省按 HTML 语义取 `1`（显式 `step="any"` 表示没有固定步长）。它同时是**显示精度**
 * （显式 step 的十进制位数，如 `0.2` → 1 位、`30` → 整数），但不参与校验（见 docs/input.md）。
 */
export interface InputProps extends Omit<HTMLInputAttributes, "value"> {
  value?: InputValue;
  /** 数值分支：横向 / 纵向布局 */
  orientation?: InputOrientation;
  /**
   * 数值分支：单位表——单张量纲表（`STD_UNITS.length`）或整个注册表（`STD_UNITS`）。
   *
   * - 传量纲表时**显示单位缺省就是它的 `base`**：`units={STD_UNITS.mass}` 即「按 kg 显示」，
   *   用户敲 `1234克` 会在输入过程中就地换算成 `1.234`，`kg` 作为只读标签留在右侧；
   * - 传注册表时必须再给 `activeUnit`（否则无法确定量纲，等同于没有 units）；
   * - 无换算需求的纯标签（`%` / `px`）用一张单表即可：`{ base: '%', units: { '%': 1 } }`。
   *
   * 见 [`docs/input.md`](../../../../docs/input.md) 与 [`docs/units.md`](../../../../docs/units.md)。
   */
  units?: Registry | Dimension;
  /**
   * 数值分支：当前**显示单位** id；缺省时取 `units` 量纲表的 `base`（传注册表时必须显式给）。
   *
   * - `value` 以该量纲的**基准单位**存储（显示单位 `cm` 时输入 `12` → `value = 0.12`）；
   * - 粘贴/输入带单位后缀的文本（`12cm`、`1234克`）会换算到显示单位再写入；
   * - `min`/`max`/`step` 仍按**显示单位**表述（显示单位 `cm` 时 `max={100}` 就是 100cm）；
   * - 实例创建后视为常量（还没有单位切换 UI）。
   */
  activeUnit?: string;
  /**
   * 数值分支：校验后的值输出通道（回调即 Svelte 5 的事件机制，与 `oninput` / `onchange` 同构）。
   *
   * - 只**钳 `min`/`max`**，不按 `step` 取整——`step` 不参与校验，步进规则（智能整数位 /
   *   用户最大精度）本来就会落在 step 网格之外，取整会推翻「尊重用户最小精度」。
   * - `value` 非有限（非法文本 → `NaN`，或空值）时给 `undefined`，**绝不下发 `NaN`**。
   * - `value` 已是唯一真值源，所以这里是单向输出，不做 `bind:validValue`。
   */
  onvalidvalue?: (value: number | undefined) => void;
}
