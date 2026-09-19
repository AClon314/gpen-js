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
├── span.input-unit          (显示单位非空时, aria-hidden)
└── button.input-step--up    (+)
```

- `aria-valuenow/min/max/valuetext`（有显示单位时）、`aria-invalid`（校验失败时）。
- `aria-valuenow`/`aria-valuetext` 给的是**显示单位**下的值（`value` 本身是基准单位）。
- **尺寸只由 InputNumber 决定，外层壳（`Input` / `InputSlider`）跟着它，不自己撑开**：
  - 横向：`width: 100%`（填满父容器）、`height: calc(2 * var(--gpen-line-height) * 1lh)`；
    控件自己声明 `line-height: var(--gpen-line-height)`，所以 `1lh` 只由 token × 自身字号决定，
    与宿主页的 `line-height` 无关；
  - 纵向：`width: calc(var(--gpen-char-width, 6) * 1ch)`、`height: auto` +
    `min-height: calc(4 * var(--gpen-row))`（4 × 2lh），同时 `flex: 1 1 auto`——
    父级是 flex 列时撑满剩余高度，普通块级父容器里退回 8lh，所以不会溢出卡片。
  - **纵向每行 = 2 个 token 行高**（与水平控件等高）：`--gpen-row: calc(2 * var(--gpen-line-height, 1) * 1lh)`。
    ± 与单位标签固定 `height: var(--gpen-row)`、`flex: 0 0 auto`（字号回落到根字号，`1lh` 才等于
    根的行高），多出来的高度全给可编辑的 value（`flex: 1 1 auto`）。四行要正好铺满控件，
    所以纵向形态不加纵向 padding（横向 padding 由根那条覆盖）。
- 垂直布局用 `flex-direction: column` + `order`（视觉 `+ / value / 单位标签 / −`，焦点顺序仍是 down→up）。
- 子元素只用 `flex`；InputSlider 通过 `--input-background*` 把内层背景设成透明以露出浮层。

## Props / 提交 / 校验

| prop                   | 行为                                                      |
| ---------------------- | --------------------------------------------------------- |
| `value`                | `$bindable` 的 `number \| string`                         |
| `orientation`          | 数值分支专用                                              |
| `step`                 | 步进量（± / 贴边 ←/→ / 滑条中央分区）；缺省按 HTML 取 `1` |
| `min` / `max`          | **只做校验**：不静默改绑定值（见下）；按**显示单位**表述  |
| `onvalidvalue`         | 校验后的值：钳 `min`/`max`、不按 `step` 取整（见下）       |
| `units` / `activeUnit` | 单位表与当前显示单位；见「单位」一节                      |
| 其余                   | `Omit<HTMLInputAttributes,'value'>`                       |

- `oninput`：空/非有限值不写绑定值；有效时写值并记下 `draftDecimals`（用户敲的小数位，含尾零）。
- `onchange`（失焦/Enter）：有效数值**原样写回**（不取整不钳制）；带单位后缀的文本在此换算
  （见下「单位」）；空→回聚焦快照；非数字→绑定值 `NaN`、文本保留。
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

### validValue：校验后的值输出通道

`value` 是唯一真值源；组件另给一条**只读**的校验结果通道，不做 `bind:validValue`：

```svelte
<Input bind:value={size} min={0} max={10} step={0.5}
       onvalidvalue={(v) => (limited = v)} />
```

```ts
validValue = finiteNumber(value) === undefined
  ? undefined                     // 非法文本（NaN）或空值：不下发 NaN
  : clampTo(value, min, max);     // 只钳 min/max，【不按 step 取整】
```

- 回调 prop 就是 Svelte 5 runes 下的事件机制（`createEventDispatcher` + `on:` 已是 legacy），与
  `oninput` / `onchange` 同构，所以形状就是 `onvalidvalue?: (value: number | undefined) => void`。
- 实现是 `InputNumber` 里的一个 `$derived` + 一个 `$effect`，天然覆盖「挂载初值 / 外部改值 /
  用户输入」三条路径，不挂在 `commit()` 的各出口上。
- **为什么不调 `validateNumeric`**：那个纯函数会先钳边界再**按 `step` 取整**。而 `step` 不参与校验
  （见上），智能整数位/用户最大精度本来就会落在 step 网格之外（`step=0.01` 也能到 `0.008`），
  这里取整会推翻「尊重用户最小精度」。所以 `validValue` 只钳 `min`/`max`；要 step 网格上的值，
  调用方自己调 `validateNumeric(value, { min, max, step })`。
- 例：`min=0 max=10` 时输入 `150`，`value` 仍是 `150`（打字不钳），`onvalidvalue` 给 `10`。
- 转发链：`Input.svelte` 的原生分支必须把 `onvalidvalue` **显式解构掉**，否则 `{...rest}` 会把它
  当成原生 `<input>` 的 `validvalue` 事件监听器挂上去；数值分支再显式转给 `InputSlider` → `InputNumber`。

### 单位（`units` / `activeUnit`）

单位表与换算纯逻辑在 [`docs/units.md`](units.md)（`src/lib/inputs/units.ts`），控件只做接线；
`InputNumber` 把「显示单位 + 两个换向 + 解析」打包成 `bindUnit()`，不自己拼散件。

```svelte
<!-- 只给一张量纲表：显示单位 = 它的 base（kg） -->
<Input bind:value={mass} units={STD_UNITS.mass} min={0} />
<!-- 整张注册表 + 显式显示单位 -->
<Input bind:value={height} units={STD_UNITS} activeUnit="cm" min={0} max={200} />
<!-- 无换算的纯标签（% / px）：一张恒等单表，base 就是标签 -->
<Input bind:value={pct} units={{ base: '%', units: { '%': 1 } }} />
```

| 概念 | 约定 |
| --- | --- |
| `units` | 一张量纲表（`STD_UNITS.mass`）或整个注册表（`STD_UNITS`）；缺省 `STD_UNITS` |
| `activeUnit` | 显示单位 id；**缺省取量纲表的 `base`**。传注册表时必须显式给，否则无法确定量纲（等同于没有 units） |
| `value` | 以该量纲的**基准单位**存储。显示单位 `cm` 时输入 `12` → `value === 0.12`（m） |
| `min`/`max`/`step` | 按**显示单位**表述（显示单位 `cm` 时 `max={100}` 就是 100cm），比较 `value` 前内部换成基准单位 |
| `onvalidvalue` | 也是基准单位（和 `value` 同单位） |
| 显示文本 | `value` 换算到显示单位后的数值；单位作为**只读标签**留在右侧（不在 input 的 value 里） |

**带单位的文本在「提交」时才换算，不在打字过程中换算**（`commitTypedQuantity`）：

- 输入 `1234g`：编辑期间文本原样保留、**不换算**；**失焦**（或 Enter）才变成 `1.234`，`value` 是
  `1.234` kg，`kg` 作为只读标签留在旁边。二次编辑只会改到 `1.234` 这个数字。
- 前后空格与「数字 / 单位之间」的空格在提交时用 `trim()` + split 处理（NFKC 归一化、大小写不敏感），
  所以 `' 1234克 '` 与 `'1234 克'` 等价。
- **红底只表示「单位错」**：`invalid` 的判据是「既不是纯数字、也不是 `units` 支持的合法量」。
  所以
  - `1234g` / `1234 克`（单位正确、只是还没提交）→ **中性**，不标红、不写绑定值；
  - `12 xyz`（单位认不出）、`12 cm`（质量字段里的长度单位，跨量纲）→ 红底 + `customValidity`，
    失焦也不换算、文本原样保留；
  - `1.2.3` 这类压根不是数字的文本 → 红底（与引入单位之前一致）。
- **粘贴是显式赋值**，仍然立即换算（整段替换，不是插到光标处）：悬浮 `Ctrl+V` 时控件本来就没有焦点，
  不会再有 blur 来触发提交。字段内粘贴同样如此。
- 换算走 `convertValue`（内部经基准单位），所以 `K ⇄ C ⇄ F` 这类**仿射换算**也对；不要自己乘系数。
- `activeUnit` **实例创建后视为常量**（还没有单位切换 UI）。
- 没有任何显示单位时（缺省注册表且无 `activeUnit`）所有换算都是恒等，行为与引入单位之前逐字一致。

### 悬浮 Ctrl+C / Ctrl+V（Blender 习惯）

鼠标悬浮在控件上、且焦点不在任何可编辑元素里时，`Ctrl+C` 把**显示单位下的当前值**写进系统剪贴板，
`Ctrl+V` 把剪贴板内容粘回控件（同样认单位后缀：插 `'1234克'` 会变成 `1.234`）。

- 用 `copy` / `paste` 事件实现，不走 `navigator.clipboard`：不需要权限、不依赖异步 API，页面上没有选区时照样触发。
- 焦点在**本控件的 input** 上时（正在编辑）一律让路，保留原生的选区复制/粘贴语义。
  焦点在其它可编辑元素（页面输入框、contenteditable）上时也不抢。
- 禁用（`disabled`）/ 只读（`readOnly`）的控件不参与；粘贴内容解析不出数值时不动。
- 与悬浮 Delete 共用同一个「悬浮态」窗口监听（`pointerenter` / `pointerleave`）。

### 非法文本

非空、`Number()` 非有限（`1.2.3`、`abc`、`1e999`），**并且**不是 `units` 支持的「数字 + 单位」量
→ `customValidity` + `:invalid` 红底，文本保留、绑定值 `NaN`；`<form>.checkValidity()` 会拦下。
清空不算非法。语法以 `Number()` 为准（`0x10` 合法）。

配了 `units` 时那条例外很重要：`1234g` 虽然 `Number()` 是 `NaN`，但它是**合法量、只是尚未提交**，
所以不标红也不改绑定值（提交时才换算，见上）。

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

- **规则在 `pointerdown` 时按落点选定，松开前不变**（`data-step-rule` 暴露当前值便于调试/测试）：
  从靠 − 的 1/3 拖进靠 + 的 1/3，全程仍是智能整数位，不会半路换成新分区的规则。
- 纵向形态里 − 在下、+ 在上，所以「智能整数位」段在最下面。
- 步进是**离散**的：每 6px 兑换一步（`STEP_PIXELS`，与 CodeMirror scrubber 同灵敏度），
  方向由拖拽位移符号决定，余量留到下一次（来回微动不会反复触发）。
- 每一步都往内部 input 派发 `input`（消费方回调 + InputNumber 的 `draft`/`draftDecimals` 与手工编辑同路径），
  拖拽结束再补一次 `change`。
- 多指同时落下时只认第一根手指：后来者不抢锚点与规则（`pending` 期间忽略后续 `pointerdown`）。

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
- **无限拖拽（桌面鼠标）**：确认拖拽后、指针类型为鼠标时申请 `pointerLock`，锁定后用 `movementX/Y`
  累加（可拉过屏幕边缘）；失败/被拒退回绝对坐标。
- **移动端 / 触屏优先设备**（`(pointer: coarse)`，含 Android Chrome）：**不申请指针锁**——那里的
  Pointer Lock 仍是实验性实现，`movementX/Y` 的轴、缩放、灵敏度都不可靠，锁上反而拖不动或乱跳；
  这些设备（手指或外接鼠标都一样）统一走「`setPointerCapture` + 绝对坐标」，靠指针捕获让手指
  移出控件后事件仍回到控件上。
- `touch`/`pen` 也从不申请指针锁（锁定会弹「按 ESC 退出」提示，而且本来就有屏幕边界）；
  WebDriver 的合成 `movementX/Y` 无效，`navigator.webdriver` 时同样跳过。
- 拖拽中浏览器接管手势（滚动/缩放）会发 `pointercancel`：按当前值收尾（等同松手），不会卡在 scrub。
- 覆盖情况：e2e 用 CDP 合成真实 touch 事件（`hasTouch` + `isMobile` 上下文）覆盖「落点锁规则」
  「跨区不换规则」「第二根手指不抢拖拽」；Android Chrome 上 Pointer Lock 的具体劣化无法在桌面
  Chrome 复现，那部分只能靠真机回归。
- CodeMirror 的 `±` 把手仍用**连续**拖拽（`numericScrub.ts` 的 `scrubValue`：精度取当前 token 的小数位，
  6px 一个精度单位）；离散三段分区是 InputSlider 独有的。

## 悬浮 Delete

默认值取组件创建时的 `value`。**只有悬浮且未聚焦**时裸 Delete 重置为它（window 兜底）；
**一旦激活（聚焦），Delete 就是原生向后删除**。焦点在其它可编辑元素、或带修饰键时不抢。

## 与 CodeMirror 共用

`stepAtCaret` / `addStepToValue` / `toggleSign` / `softClampTo` / `finiteNumber` / `roundTo` /
`clampTo` / `scrubValue` 被两个 CodeMirror 6 扩展与两个输入组件共用（方向键步进、`±` 拖拽把手），
见 [`docs/codemirror.md`](codemirror.md)。

拖拽像素→步进的量化也抽成了纯函数 `consumeScrubSteps(accumulated, consumed, pixelsPerStep)`：
返回这次该走几步 + 已经花掉的像素（余量留到下一次，微动不反复触发），InputSlider 的三段分区
与 CodeMirror 的连续拖拽共用同一个 `SCRUB_PIXELS_PER_STEP = 6` 灵敏度。

## 如何增加新 input 类型

默认不用加（传 `type="date"` 等就走原生）。只有原生不够时在 `Input.svelte` 加分支，并扩展
`InputProps`（新 props 要在原生分支显式解构掉）：

```svelte
{#if numeric}<InputSlider bind:value {orientation} {units} {activeUnit} {...rest} />
{:else if type === 'color'}<InputColor bind:value {type} {...rest} />
{:else}<input {type} bind:value {...rest} />{/if}
```
