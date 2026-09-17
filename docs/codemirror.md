# CodeMirror 6 数值插件

两个 CodeMirror 6 扩展，把 InputNumber 的步进逻辑接到编辑器里，**不重写步进算法**：

```text
src/lib/inputs/
├── numericCaret.ts              # 纯函数：stepAtCaret / stepByRule / addStepToValue / toggleSign / roundTo / clampTo …
├── numericScrub.ts              # 纯函数：scrubValue / scrubSensitivity / scrubQuantum（拖拽像素→值）
└── codemirror/
    ├── numberStepper.ts         # 扩展①：方向键步进光标下的数字
    ├── numberScrubber.ts        # 扩展②：2ch 宽的 ± 拖拽把手
    └── index.ts
```

| 逻辑          | 纯函数                                           | InputNumber / InputSlider     | CodeMirror                                |
| ------------- | ------------------------------------------------ | ----------------------------- | ----------------------------------------- |
| 按位权 ↑/↓    | `stepAtCaret`                                    | `applyResult`                 | `numberStepper`                           |
| 按固定值 ±    | `addStepToValue`                                 | 贴边 ←/→、± 按钮              | —（editor 里没有“贴边”概念）              |
| 按规则步进    | `stepByRule` / `stepByDigit` / `stepByPrecision` | InputSlider 的三段分区        | —                                         |
| 正负号切换    | `toggleSign`                                     | `-` / `+` 键、case 5          | `stepAtCaret` 的 case 5 已含              |
| 取整 / 钳边界 | `roundTo` / `clampTo` / `softClampTo`            | `softClamp` / `commandCommit` | stepper 的 `decimals` / `lower` / `upper` |
| 拖拽像素→值   | `scrubValue` / `scrubSensitivity`                | —（改用离散步进）             | `numberScrubber`                          |

## numberStepper（方向键）

```ts
import { numberStepper } from "#lib/inputs/codemirror/numberStepper";

numberStepper({ lower: 0, upper: 100, decimals: 2 });
```

- 用 `Prec.high(EditorView.domEventHandlers({ keydown }))` 抢在 `defaultKeymap` 之前；
  返回 `true` 由 CodeMirror 自动 `preventDefault`。
- 触发规则：
  - **单行文档**：`↑`/`↓` 步进；`←`/`→` 保持原生光标移动，不步进；
  - **多行文档**：只有 `CapsLock` + 任意方向键才步进（`↑`/`→` = `+1`，`↓`/`←` = `-1`），
    否则方向键继续导航。
- 找 token：`/[+-]?(?:\d+\.?\d*|\.\d+)/` 逐行匹配，取 caret 落在区间内的那个；caret 贴在
  token 末尾也算。没有数字 → 返回 `false`，方向键照常走。
- 一次 transaction 同时替换 token 并设置新 caret：
  `view.dispatch({ changes: {from, to, insert}, selection: EditorSelection.cursor(...) })`。
- 复用 `stepAtCaret` 选位权；`decimals`/`lower`/`upper` 再走 `roundTo` + soft clamp，与
  InputNumber 同一套语义。

## numberScrubber（拖拽 ± 把手）

```ts
import { numberScrubber } from "#lib/inputs/codemirror/numberScrubber";

numberScrubber({ lower: 0, upper: 100 });
```

- 一个 inline `WidgetType`（`±`，2ch 宽），装饰在**光标所在行的行尾**（`ViewPlugin` +
  `decorations: v => v.decorations`，光标移动或文档变化时重建）。
- 拖拽目标：光标所在的数字 token，没有则文档里第一个数字。
- 拖拽精度沿用 token 文本的小数位（`decimalPlacesInText`），灵敏度 = 精度 / 6px，落位走
  `scrubValue(start, pixels, decimals, origin, lower, upper)`。编辑器里连续拖拽最自然；
  InputSlider 改用离散三段分区（`stepByRule`，每 6px 一步），两者只共享 6px 的灵敏度。
- 拖拽实现要点：
  - pointerdown 时 `stopPropagation()`，并在 `document` 上挂 `pointermove`/`pointerup`，
    而不是靠 widget 自身的 pointer capture：文档每变一次都会重建装饰，元素可能在 DOM 里
    被移动，`document` 级监听最稳。
  - `eq()` 恒为 `true`，让 CodeMirror 在文档变化时**复用同一个 DOM 节点**，拖动中的监听不丢；
    目标 token 的范围在 pointerdown 时确定，之后用 `length` 增量维护，不再读 caret。
  - `ignoreEvent()` 返回 `true`（默认）让 CodeMirror 忽略 widget 内的事件；自己挂的
    `pointerdown` 不受影响。
  - `destroy(dom)` 里用 `AbortController` 解绑，避免 widget 被移除后泄漏。

## demo

`src/routes/demo/code/+page.svelte`：一个单行编辑器（直接 `↑`/`↓` 步进 + `±` 拖拽）和一个
多行编辑器（方向键导航，`CapsLock` + 方向键步进）。`onMount` 里 `new EditorView(...)`，
`onMount` 的返回值里 `view.destroy()`。

最小依赖是 `@codemirror/state` + `@codemirror/view` + `@codemirror/commands`
（`history`、`defaultKeymap`、`historyKeymap`、`drawSelection`），没有引入 `codemirror`
元包（那会带上 autocomplete/fold/search 一大串）。
