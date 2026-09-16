# Input 组件

## 结构

`Input` 是很薄的分发壳；只有 `number`（和将来的 `color`）自研，其余 `<input type>` 一律原生：

```text
src/lib/components/widgets/inputs/
├── Input.svelte        # 分发：number+slider → InputSlider，number → InputNumber，其余 → 原生 <input>
├── InputNumber.svelte  # 数值：type="text" + inputmode="decimal"，自管数值语义
├── InputSlider.svelte  # 数值 + 浮层：Blender 风拖拽滑条（内嵌 InputNumber）
└── types.ts
```

分发依据 `type === 'number' || (type === undefined && typeof value === 'number')`，再按 `slider` 分流。
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
- 垂直布局用 `flex-direction: column` + `order`（视觉 `+ / value / unit / −`，焦点顺序仍是 down→up）。
- 尺寸只加在根上，由变量覆盖：`width: var(--input-width, 16ch)`、高度 `calc(2 * var(--gpen-line-height) * 1em)`；
  子元素只用 `flex`。InputSlider 通过 `--input-background*` 把内层背景设成透明以露出浮层。

## Props / 提交 / 校验

| prop | 行为 |
| --- | --- |
| `value` | `$bindable` 的 `number \| string` |
| `orientation` / `unit` / `slider` | 数值分支专用 |
| `step` | 步进 UI 的推荐步长（± / 贴边 ←/→）；校验时作精度 |
| `min` / `max` / `step` | **只做校验**：不静默改绑定值（见下） |
| 其余 | `Omit<HTMLInputAttributes,'value'>` |

- `oninput`：空/非有限值不写绑定值；有效时写值并记下 `draftDecimals`（用户敲的小数位，含尾零）。
- `onchange`（失焦/Enter）：有效数值**原样写回**（不取整不钳制）；空→回聚焦快照；非数字→绑定值 `NaN`、文本保留。
- `Escape` 回聚焦快照。步进/滚轮/±/Home·End/悬浮 Delete/右键菜单都走同一提交出口 `commit()`，广播 `input`+`change`。
- **显示精度**：`formatValue` 用 `draftDecimals ?? stepDecimals`，所以把 `18.00` 改成 `18.0` 后，外部改值排版成 `18.1` 而不是 `18.10`。

### min / max / step 只是校验

组件不替调用方改值；想要限制后的值就调纯函数：

```ts
import { validateNumeric } from "#lib/inputs/numericCaret";
const limited = validateNumeric(value, { min: 0, max: 100, step: 0.2 }); // clamp + 按 step 位数取整
```

- 打字：不取整、不钳制。
- 步进/滚轮/拖拽：**soft 边界** —— 起点在界内才 `clampTo(结果)`，已超界就不钳（先把值填成 150，↑/↓ 仍能自由走）。
- 违规只进原生校验：`setCustomValidity('不能小于/大于 …' / '必须是 … 的倍数')`，`<form>` 拦提交，绑定值不变。
- `Home`/`End`/右键「设为最大/小值」这类命令式提交总是钳到边界。

### 非法文本

非空且 `Number()` 非有限（`1.2.3`、`abc`、`1e999`）→ `customValidity` + `:invalid` 红底，文本保留、
绑定值 `NaN`；`<form>.checkValidity()` 会拦下。清空不算非法。语法以 `Number()` 为准（`0x10` 合法）。

### 右键菜单

`use:contextMenu` 注册 Blender 风菜单：重置为默认值 / 设为最小值 / 设为最大值（无对应边界则禁用）。
禁用时返回空数组，浏览器原生菜单照旧。

## caret 精度步进

纯逻辑在 `src/lib/inputs/numericCaret.ts`（无 DOM / 无 Svelte）。一句话：**caret 选一个小数位，
↑/↓ 对数值的量值加/减 `10 ** place`**；符号独立，量值不会压到 0 以下。

| 情况 | caret | place | 例 |
| --- | --- | --- | --- |
| 1 | 贴最左/最右再按 ←/→ | 配置 `step` | `42` ^← → `41` |
| 2 | 数字右侧 | 该数字位权 | `23.4^5` ↑ → `23.5^5` |
| 3 | 数字前面 | 最左整数位 | `^90` ↑ → `^100` |
| 4 | 小数点右侧 | 第一个非零小数位 | `0.^009` ↑ → `0.^01` |
| 5 | 符号左侧 | — | `^-5` ↑ → `^+5` |
| 6 | 滚轮（已聚焦时） | 同 ↑/↓ | — |

- case 2/3 保留原有小数宽度：`23.49^` ↑ → `23.50^`（不是 `23.5`）。
- case 3 向 0 走时，首位 `1` 降一级：`^109` ↓ → `^99`、`^100` ↓ → `^90`、`^10` ↓ → `^9`；
  带小数位的单位 `1` 进小数轮：`^1.0` ↓ → `0.^9`（`^1` 整数字段仍降到 `0`）。
- case 4 宽度跟随活动位：`0.^01` ↓ 会扩展成 `0.^009`；`0.^9` ↑ 进位成 `^1`。
- case 5 / `-`/`+` 键：符号区（最左或符号后）内 `-` 在 `-5 ⇄ +5` 间循环（保留显式 `+`），`+` 强制为正；
  显式 `+` 会保留到步进（`+5` ↑ → `+6`）。负数保留符号只动量值（`-^89` ↑ → `-^99`）。
- Shift 不做倍率。`←`/`→` 贴边时按 `step` 步进（值语义，可跨零），与 ± 按钮同一出口；
  非数值 `step`（如 `step="any"`）安全忽略。滚轮等价 ↑/↓，但**只在控件已激活（input 聚焦）时**触发，否则留给页面滚动。
- 写回 selection 要「同步 setSelectionRange + `tick()` 后补一次」：写 `value` 会把 caret 挪到末尾，
  而 Svelte 的 `value={draft}` 更新晚一拍；补写前确认文本未变且 caret 确实被推到末尾，避免抢用户 caret。

## InputSlider（无极滑条）

内嵌 InputNumber + 按 min/max 比例填充的浮层：

- **点击/轻触**：走原生 focus，进 InputNumber 编辑模式；此时拖拽交给原生选区。
- **长按(250ms) 或拖拽(>4px)**：不激活编辑模式，`blur` 后进入 scrub。确认拖拽才 `setPointerCapture`
  （pointerdown 就捕获会让 mousedown 改派、输入框拿不到焦点）。
- **拖拽精度取当前输入文本的小数位**（`18.0` → 0.1、`9.98` → 0.01、整数 → 1），与 CodeMirror
  scrubber 共用 `scrubValue`（`numericScrub.ts`）：`roundTo` + soft min/max。灵敏度 = 精度 / 6px。
- 拖拽结束 `tick()` 后再在内部 input 上派发 `input`+`change`，消费方回调与手工编辑同路径。
- **无限拖拽**：确认拖拽后、且指针类型为鼠标时申请 `pointerLock`，锁定后用 `movementX/Y` 累加
  （可拉过屏幕边缘）；失败/被拒退回绝对坐标。**touch/pen 不申请**（避免弹「按 ESC 退出」提示，
  本来就受屏幕边界约束）；WebDriver 的合成 movement 无效，`navigator.webdriver` 时也跳过。

## 悬浮 Delete

默认值取组件创建时的 `value`。**只有悬浮且未聚焦**时裸 Delete 重置为它（window 兜底）；
**一旦激活（聚焦），Delete 就是原生向后删除**。焦点在其它可编辑元素、或带修饰键时不抢。

## 与 CodeMirror 共用

`stepAtCaret` / `addStepToValue` / `toggleSign` / `roundTo` / `clampTo` / `scrubValue` 被两个
CodeMirror 6 扩展复用（方向键步进、`±` 拖拽把手），见 [`docs/codemirror.md`](codemirror.md)。

## 如何增加新 input 类型

默认不用加（传 `type="date"` 等就走原生）。只有原生不够时在 `Input.svelte` 加分支，并扩展
`InputProps`（新 props 要在原生分支显式解构掉）：

```svelte
{#if numeric && slider}<InputSlider bind:value {orientation} {unit} {...rest} />
{:else if numeric}<InputNumber bind:value {orientation} {unit} {...rest} />
{:else if type === 'color'}<InputColor bind:value {type} {...rest} />
{:else}<input {type} bind:value {...rest} />{/if}
```

## 消融记录（精简）

| 能力 | 处理 | 理由 |
| --- | --- | --- |
| `InputText.svelte` / `label` prop | 删除 | 文本走原生 `<input>`；`aria-label` 已有 |
| `precision` prop | 并入 `step` | step 的十进制位数就是精度 |
| `placeValueForCaret` / `stepValueForCaret` / `stepNumericText` | 合并成 `stepAtCaret` + `addStepToValue` | 前两者只是“选 place”，后者只是“算值+caret” |
| case 3 与 fallback 的两份 front 计算 | 提成 `frontStep()` | 决策表行 3/6 同构 |
| `applyResult` / `commandCommit` 各自写回+广播 | 提成 `commit()` | 三件套完全同构 |
| `handleKeydown` 里 4 处 `disabled` 判断 | 提成顶层 guard | disabled 是多个分支的支配条件 |
| `min/max/step` 自动取整/钳值 | 只做校验 + 导出 `validateNumeric` | 边界/精度是调用方约束，组件不该静默改绑定值 |
| 全局 strip 尾零 | case 2/3 固定宽度 / case 4 跟随活动位 | `23.49↑→23.50`，而 `0.009↑→0.01` |
| Shift 倍率、`toPrecision(12)`、`writeInput` 等 | 删除 | 与 spec 不符 / 被更简单的整数缩放替代 |
| 聚焦时也拦截 Delete | 只未聚焦时重置 | 激活后 Delete 应是原生删除 |
| `scrubValue` / `roundTo` / `clampTo` | 提到 `numericScrub.ts` / core 导出 | InputSlider 与 CodeMirror 共用同一套 |

更细的「条件原子化 → 决策表 → 冗余/支配/互斥 → 父级 if → 等价重构 → 差分测试」过程见
本轮 commit / 历史，结论已落在上面的代码结构里。
