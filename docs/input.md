# Input 组件

## 结构

`Input` 是很薄的分发壳；只有 `number`（和将来的 `color`）自研，其余 `<input type>` 一律原生：

```text
src/lib/components/widgets/inputs/
├── Input.svelte        # 分发：number → InputSlider，其余 → 原生 <input>
├── InputNumber.svelte  # 数值：type="text" + inputmode="decimal"，自管数值语义
├── InputSlider.svelte  # 数值 + 浮层：Blender 风拖拽滑条（内嵌 InputNumber）
└── types.ts
```

分发依据 `type === 'number' || (type === undefined && typeof value === 'number')`：数值一律走
InputSlider（滑条 + 直接输入，大多数人要的形态）；要纯数值框时直接 import `InputNumber.svelte`。
字符串走裸 `<input bind:value {...rest}>`。

## 原生优先

能原生就原生：原生属性、约束校验（`setCustomValidity` / `:invalid`）、剪切复制粘贴、右键菜单。
唯一必须自研的是 `number`：Chrome 的 `<input type="number">` 没有 `selectionStart` /
`setSelectionRange`，做不了「按光标位权步进」。所以用 `type="text" inputmode="decimal"`，再用
`role="spinbutton"`、`aria-*`、`setCustomValidity` 把数值语义补回来（`type`/`inputmode` 写在
`{...rest}` 之后，调用方不能覆盖）。`color` 将来同理。

## DOM 与尺寸

```text
div.input-widget[data-input-widget][data-orientation][role="group"]
├── button.input-step--down  (−)
├── input.input-field        (type="text" inputmode="decimal" role="spinbutton")
├── span.input-unit          (unit 非空时, aria-hidden)
└── button.input-step--up    (+)
```

- `aria-valuenow/min/max/valuetext`（有 unit 时）、`aria-invalid`（校验失败时）。
- **尺寸只由 InputNumber 决定，外层壳（`Input` / `InputSlider`）跟着它，不自己撑开**：
  - 横向：`width: 100%`（填满父容器）、`height: calc(2 * var(--gpen-line-height) * 1lh)`；
    控件自己声明 `line-height: var(--gpen-line-height)`，所以 `1lh` 只由 token × 自身字号决定，
    与宿主页的 `line-height` 无关；
  - 纵向：`width: calc(var(--gpen-char-width, 6) * 1ch)`、`height: auto` +
    `min-height: calc(4 * var(--gpen-line-height) * 1lh)`，同时 `flex: 1 1 auto`——
    父级是 flex 列时撑满剩余高度，普通块级父容器里退回 4 行高（+ / value / unit / − 各一行），
    所以不会溢出卡片。
- 垂直布局用 `flex-direction: column` + `order`（视觉 `+ / value / unit / −`，焦点顺序仍是 down→up）。
- 子元素只用 `flex`；InputSlider 通过 `--input-background*` 把内层背景设成透明以露出浮层。

## Props / 提交 / 校验

| prop                   | 行为                                                      |
| ---------------------- | --------------------------------------------------------- |
| `value`                | `$bindable` 的 `number \| string`                         |
| `orientation` / `unit` | 数值分支专用                                              |
| `step`                 | 步进量（± / 贴边 ←/→ / 滑条中央分区）；缺省按 HTML 取 `1` |
| `min` / `max`          | **只做校验**：不静默改绑定值（见下）                      |
| 其余                   | `Omit<HTMLInputAttributes,'value'>`                       |

- `oninput`：空/非有限值不写绑定值；有效时写值并记下 `draftDecimals`（用户敲的小数位，含尾零）。
- `onchange`（失焦/Enter）：有效数值**原样写回**（不取整不钳制）；空→回聚焦快照；非数字→绑定值 `NaN`、文本保留。
- `Escape` 回聚焦快照。步进/滚轮/±/Home·End/悬浮 Delete/右键菜单都走同一提交出口 `commit()`，广播 `input`+`change`。
- **显示精度**：`formatValue` 用 `draftDecimals ?? stepDecimals`，只认**显式** `step` 的位数
  （缺省 step 不取整）；所以把 `18.00` 改成 `18.0` 后，外部改值排版成 `18.1` 而不是 `18.10`。
- 显式非数值 `step`（如 `step="any"`）没有固定步长：安全忽略，滑条中央分区退回「用户最大精度」。

### min / max 只是校验

组件不替调用方改值；想要限制后的值就调纯函数：

```ts
import { validateNumeric } from "#lib/inputs/numericCaret";
const limited = validateNumeric(value, { min: 0, max: 100, step: 0.2 }); // clamp + 按 step 位数取整
```

- 打字：不取整、不钳制。
- 步进/滚轮/拖拽：**soft 边界**（纯函数 `softClampTo`）——起点在界内才钳，已超界就不钳
  （先把值填成 150，↑/↓ 仍能自由走）。
- 违规只进原生校验：`setCustomValidity('不能小于/大于 …')`，`<form>` 拦提交，绑定值不变。
  `step` 不参与校验——智能整数位/用户最大精度本来就会落在 step 网格之外（`step=0.01` 也能到 `0.008`）。
- `Home`/`End`/右键「设为最大/小值」这类命令式提交总是钳到边界。

### 非法文本

非空且 `Number()` 非有限（`1.2.3`、`abc`、`1e999`）→ `customValidity` + `:invalid` 红底，文本保留、
绑定值 `NaN`；`<form>.checkValidity()` 会拦下。清空不算非法。语法以 `Number()` 为准（`0x10` 合法）。

### 右键菜单

`use:contextMenu` 注册 Blender 风菜单：重置为默认值 / 设为最小值 / 设为最大值（无对应边界则禁用）。
禁用时返回空数组，浏览器原生菜单照旧。

## 步进规则

三种量级，纯函数都在 `src/lib/inputs/numericCaret.ts`（无 DOM / 无 Svelte）：

| 规则         | 量级                             | 例                                                                |
| ------------ | -------------------------------- | ----------------------------------------------------------------- |
| 智能整数位   | 前导有效数字的位权 `10 ** place` | `1.12 → 0.12 → 0.02 → 0.01 → 0.009`（递减无限趋近 0，不会塌到 0） |
| 配置 `step`  | 调用方给的 `step`（缺省 `1`）    | `23.45 → 23.55`（`step=0.1`）                                     |
| 用户最大精度 | 输入文本里最小的小数位，含尾零   | `0.499 → 0.500 → 0.501`、`5 → 6`、`5.0 → 5.1`                     |

- 「智能整数位」跟着数值走（`1.12` 减 1、`0.12` 减 0.1、`0.02` 减 0.01），**递减时若数值正好等于位权**
  就多退一位（`1 → 0.9`、`0.01 → 0.009`）——这就是回退到**智能小数位**，于是只会无限趋近 0。
- 「用户最大精度」尊重用户敲的尾零；想更快增减就把多余小数位删掉（`0.499` → `0.5` 后每次走 0.1）。
- 入口：± 按钮与「caret 贴边时的 ←/→」用配置 `step`；InputSlider 的拖拽按下面三段分区选规则。

### InputSlider 的三段分区

滑条沿轴**平均分三段**（悬浮或拖拽时显形，`stepRuleAt(ratio)`）：

| 位置          | 规则         |
| ------------- | ------------ |
| 靠近 − 的 1/3 | 智能整数位   |
| 中央 1/3      | 配置 `step`  |
| 靠近 + 的 1/3 | 用户最大精度 |

- 纵向形态里 − 在下、+ 在上，所以「智能整数位」段在最下面。
- 步进是**离散**的：每 6px 兑换一步（`STEP_PIXELS`，与 CodeMirror scrubber 同灵敏度），
  方向由拖拽位移符号决定，余量留到下一次（来回微动不会反复触发）。
- 每一步都往内部 input 派发 `input`（消费方回调 + InputNumber 的 `draft`/`draftDecimals` 与手工编辑同路径），
  拖拽结束再补一次 `change`。
- 指针锁定后指针不再移动，分区取按下时那一段；`movementX/Y` 可以把值拉出屏幕外。

## caret 精度步进

纯逻辑同样在 `numericCaret.ts`。一句话：**caret 选一个小数位，↑/↓ 对数值的量值加/减 `10 ** place`**；
符号独立（case 5），量值不会压到 0 以下。

| 情况 | caret               | place            | 例                    |
| ---- | ------------------- | ---------------- | --------------------- |
| 1    | 贴最左/最右再按 ←/→ | 配置 `step`      | `42` ^← → `41`        |
| 2    | 数字右侧            | 该数字位权       | `23.4^5` ↑ → `23.5^5` |
| 3    | 数字前面            | 最左整数位       | `^90` ↑ → `^100`      |
| 4    | 小数点右侧          | 第一个非零小数位 | `0.^009` ↑ → `0.^01`  |
| 5    | 符号左侧            | —                | `^-5` ↑ → `^+5`       |
| 6    | 滚轮（已聚焦时）    | 同 ↑/↓           | —                     |

- case 2/3 保留原有小数宽度：`23.49^` ↑ → `23.50^`（不是 `23.5`）。
- case 3 向 0 走时，首位 `1` 降一级：`^109` ↓ → `^99`、`^100` ↓ → `^90`、`^10` ↓ → `^9`；
  带小数位的单位 `1` 进小数轮：`^1.0` ↓ → `0.^9`（`^1` 整数字段仍降到 `0`）。
- case 4 宽度跟随活动位：`0.^01` ↓ 扩展成 `0.^009`；`0.^9` ↑ 进位成 `^1`。
- case 5 / `-`/`+` 键：符号区（最左或符号后）内 `-` 在 `-5 ⇄ +5` 间循环（保留显式 `+`），`+` 强制为正；
  显式 `+` 会保留到步进（`+5` ↑ → `+6`）。负数保留符号只动量值（`-^89` ↑ → `-^99`）。
- `←`/`→` 贴边时按 `step` 步进（值语义，可跨零），与 ± 按钮同一出口。滚轮等价 ↑/↓，
  但**只在控件已激活（input 聚焦）时**触发，否则留给页面滚动。
- 写回 selection 要「同步 `setSelectionRange` + `tick()` 后补一次」：写 `value` 会把 caret 挪到末尾，
  而 Svelte 的 `value={draft}` 更新晚一拍；补写前确认文本未变且 caret 确实被推到末尾，避免抢用户 caret。

## InputSlider 的指针行为

- **点击/轻触**：走原生 focus，进 InputNumber 编辑模式；此时拖拽交给原生选区。
- **长按(250ms) 或拖拽(>4px)**：不激活编辑模式，`blur` 后进入 scrub。确认拖拽才 `setPointerCapture`
  （pointerdown 就捕获会让 mousedown 改派、输入框拿不到焦点）。
- **无限拖拽**：确认拖拽后、且指针类型为鼠标时申请 `pointerLock`，锁定后用 `movementX/Y` 累加
  （可拉过屏幕边缘）；失败/被拒退回绝对坐标。**touch/pen 不申请**（避免弹「按 ESC 退出」提示），
  WebDriver 的合成 movement 无效，`navigator.webdriver` 时也跳过。
- CodeMirror 的 `±` 把手仍用**连续**拖拽（`numericScrub.ts` 的 `scrubValue`：精度取当前 token 的小数位，
  6px 一个精度单位）；离散三段分区是 InputSlider 独有的。

## 悬浮 Delete

默认值取组件创建时的 `value`。**只有悬浮且未聚焦**时裸 Delete 重置为它（window 兜底）；
**一旦激活（聚焦），Delete 就是原生向后删除**。焦点在其它可编辑元素、或带修饰键时不抢。

## 与 CodeMirror 共用

`stepAtCaret` / `addStepToValue` / `toggleSign` / `softClampTo` / `roundTo` / `clampTo` / `scrubValue`
被两个 CodeMirror 6 扩展复用（方向键步进、`±` 拖拽把手），见 [`docs/codemirror.md`](codemirror.md)。

## 如何增加新 input 类型

默认不用加（传 `type="date"` 等就走原生）。只有原生不够时在 `Input.svelte` 加分支，并扩展
`InputProps`（新 props 要在原生分支显式解构掉）：

```svelte
{#if numeric}<InputSlider bind:value {orientation} {unit} {...rest} />
{:else if type === 'color'}<InputColor bind:value {type} {...rest} />
{:else}<input {type} bind:value {...rest} />{/if}
```
