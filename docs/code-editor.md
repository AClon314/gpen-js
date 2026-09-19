# CodeEditor（CodeMirror 6 多行文本）

`src/lib/components/widgets/inputs/CodeEditor.svelte`：多行文本输入的统一实现，内部是 CodeMirror 6，
对外装作一个 `<textarea>`（值双向绑定 + 原生表单关联 + 约束校验），可注入语言 / 扩展（将来挂语法高亮）。

```svelte
<CodeEditor bind:value={note} name="note" required maxlength={200} rows={4} aria-label="备注" />
```

只用已装的 `@codemirror/state` / `@codemirror/view` / `@codemirror/commands`（不引 `codemirror`
元包，那会带上 autocomplete / fold / search 一大串），接线范式照
[`docs/codemirror.md`](codemirror.md) 与 `src/routes/demo/code/+page.svelte`。

## 缺口 + 自研代价（仓库约定）

仓库默认「原生优先」（见 [`docs/input.md`](input.md)）。`CodeEditor` 是第二个例外（第一个是
`InputNumber` 的 `number`），缺口与代价都写在这里：

| 需求                                            | 原生 `<textarea>` | 自研代价                                                                 |
| ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| 隐式快捷键（`Mod-a`、Home/End、缩进、多光标…）  | 只有浏览器默认    | 多 3 个 CM 包 + 一套 keymap；好处是这些键位在两个编辑器里语义一致         |
| 挂数值扩展（`numberStepper` / `numberScrubber`） | 做不到           | 一个 CM 依赖；换来与 `InputNumber` 共用同一套纯函数                        |
| 编辑器结构（doc / selection / transaction）      | 只有字符串        | prop 面变窄：`HTMLTextareaAttributes` 不能照抄（见下表）                  |
| 表单关联 / 约束校验 / `FormData`                 | 原生即可         | **不需要自研**：靠 `hidden` 的镜像 textarea 拿回原生能力（见下）           |

代价小结：组件多了一层「CM 文档 ⇄ 绑定值 ⇄ 表单镜像」的三方同步，所有同步点都要守卫（IME、
回声、长度闸门）。这些守卫是本文件复杂度的全部来源。

## props 与原生 attribute 对照

props 基于 `Omit<HTMLTextareaAttributes, …>`，被显式接管的属性：

| attribute               | 行为                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `value`                 | `$bindable` 的 `string`，唯一真值源                                                            |
| `disabled`              | `EditorView.editable.of(false)` + `contentAttributes` 的 `tabindex="-1"` / `aria-disabled`；镜像同时 `disabled`（自动退出提交与校验） |
| `readonly`              | `EditorState.readOnly.of(true)`（CM 自己会补 `aria-readonly`）；镜像同时 `readOnly`（仍提交）   |
| `placeholder`           | `@codemirror/view` 的 `placeholder()`                                                          |
| `name` / `form`         | 只写在镜像 textarea 上（CM 不认识表单）                                                        |
| `required`              | 只写在镜像上，用原生 constraint validation                                                     |
| `maxlength`             | 双份：CM 侧 `EditorState.changeFilter` 拒绝超长事务；镜像侧同时挂 `maxlength` + `setCustomValidity` |
| `rows`                  | → `min-height: N * 1lh`（缺省 2，与原生一致）                                                   |
| `wrap`                  | `off` → 不折行；其余（含缺省 `soft`）→ `EditorView.lineWrapping`                                |
| `extensions`            | 追加到 CM 配置 compartment，`@codemirror/state` 的 `Extension[]`                                |
| `class`                 | 加在外层 `.code-editor` 上（CM 自己的主题变量走 `--gpen-*`）                                     |
| `aria-label`            | `contentAttributes`（CM 已自带 `role="textbox"` + `aria-multiline="true"`）                     |
| 其余（`spellcheck` / `autocomplete` / `id` / `data-*` / `aria-*` …） | 透传进 `contentAttributes`；**函数值（事件处理器）**与 `cols` / `minlength` / `defaultValue` / `dirname` 会被丢弃 |

明确不适用 / 放掉：

| attribute                                | 原因                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `cols`                                   | 列宽由父容器 / CSS 决定，CM 里没有「列」的概念                        |
| `minlength`                              | 原生也只在「用户编辑过」时才提示，弱校验；CM 侧复刻收益太低            |
| `selectionStart` / `selectionEnd` 系     | 只在 `HTMLTextAreaElement` 实例上，CM 的选择模型是 `EditorSelection`  |
| `defaultValue` / `dirname`               | 没有对应的 CM 语义（`dirname` 是 RTL 表单字段，CM 不参与原生提交），直接忽略            |
| `oninput` / `onchange` / `onkeydown` …   | CM 不转发这些 DOM 事件；要监听文档变化用绑定值或注入 extension                         |
| `style`                                  | 会透传到 `.cm-content` 并覆盖 CM 自己的 `tab-size`；样式请用 `class` + `--gpen-*` 变量（注：与 `InputNumber` 不同，那里的 `style` 落在控件外框，下次可统一） |

## 三份状态怎么同步

```text
外部 value ──(①)──► CM doc ──(②)──► 绑定 value ──(③)──► 镜像 textarea.value / setCustomValidity
```

- **① 外部值 → 文档**：`view.dispatch({ changes: {from:0, to:doc.length, insert} })` **整篇替换**。
  绝不重建 `EditorView`（`destroy()` + `new` 只用于挂载 / 卸载与 extensions 变化），所以 undo 历史保留。
  替换事务带 `isolateHistory.of('full')`：CM 默认会把「无 userEvent 的事务」并进 500ms 内上一次键入，
  不加注解时一次 `Ctrl+Z` 会把用户刚打的字一起撤掉。
- **② 文档 → 绑定值**：只在 `EditorView.updateListener` 的 `update.docChanged` 分支里取一次
  `update.state.doc.toString()`（不要每次按键全量物化），写回 `value` 并同步镜像。
- **③ 镜像**：见下。`maxlength` 变化单独用 `$effect` 重算 `setCustomValidity`。

### `Object.is` 守卫防的是「多余事务」，不是「重建 EditorView」

`observedValue` 记录「上次观察 / 写出的文本」：

- 打字 → doc 变化 → 写回绑定值 → 父级回传同一个值 → effect 看到相同 → `return`。没有它就会回声循环；
- 没有它还会推走用户 caret、往 undo 里塞重复事务。

**值变化永远只会走 `dispatch`；`EditorView` 的生命周期与值无关。** 两者不要混为一谈。

### IME 组字守卫

`view.composing === true` 期间**不应用**外部 `value`（缓存进 `pendingValue`），
`compositionend` 后再补一次 `dispatch`。组字期间回写 `element.value` / 派发替换事务 / 动 selection
都会打断候选串（候选窗重置、字符重复、caret 跳走）。

## 表单关联：`hidden` 镜像 textarea

```svelte
<textarea bind:this={mirror} hidden aria-hidden="true" tabindex="-1" {name} {form} {required} {maxlength} />
```

CM 自己的 DOM 不参与表单，所以用这个镜像承载全部表单语义。Chromium + Firefox 实测一致：

| 检查项                              | 结果                                                      |
| ----------------------------------- | --------------------------------------------------------- |
| `FormData` / `form.elements`        | 收得到（`hidden` 与 `display:none` 都能进）               |
| `willValidate` / 空值 + `required`  | `true` / `checkValidity() === false`（能拦提交）          |
| `getClientRects().length`           | `0`（不占布局、不进无障碍树）                             |
| `disabled`                          | 自动退出提交（`disabled` 是唯一会排除提交的状态）         |

- **不用 `<input type="hidden">`**：hidden input 被排除在 constraint validation 之外，
  `required` 与 `setCustomValidity` 全部无效。
- **不用 `<noscript>`**（原方案「noscript 里放隐藏 textarea」）——三条实测否决证据，别再试：
  1. **Svelte 5 编译器静默丢弃 `<noscript>` 的全部子节点**（文本、元素、`<style>`、`{@html}` 一律
     丢弃且 `warnings = []`）：client 产物是 `<noscript></noscript>`，只有 server codegen 才原样
     输出。要写真正的无 JS 回退只能写进 `src/app.html`。
  2. **`{@html}` 也不行且不可依赖**：唯一子节点时走 `parent_node.innerHTML`，而浏览器解析器
     （scripting enabled）把 noscript 内容当纯文本 → 无 textarea（Chromium / Firefox 同）；
     只有带兄弟节点时才走 `<template>.innerHTML`，此路 **Chromium 会建出 textarea、Firefox 不会**。
  3. `{@html}` 由 JS 运行时执行，无 JS 时根本不跑 → **语义上不可能当 no-JS 回退**。

## 长度与校验

`maxlength` 有两份，缺一不可：

- CM 侧 `EditorState.changeFilter.of(tr => tr.newDoc.length <= maxlength)`：**键入与粘贴都经过它**，
  超长事务整次拒绝（不是截断）。外部改值走一个 `ignoreLengthFilter` 开关放行——外部是唯一真值源，
  超限由镜像的校验负责报告。
- 镜像侧 `maxlength` 属性 + `setCustomValidity('最多 N 个字符')`：给 `checkValidity()` /
  `:invalid` 用。注意程序化写 `value` 不会产生原生 `tooLong`，所以消息得自己算。

`minlength` 不做（见上表）。

## 无障碍

- CM 自带 `role="textbox"` + `aria-multiline="true"`；`aria-label` / `aria-labelledby` 经
  `contentAttributes` 落到内容元素上（`getByRole('textbox', { name })` 能找到它）。
- 外部改值时若编辑器**未聚焦**，派发 `EditorView.announce.of(text)` 让屏幕阅读器播报
  （CM 会把内容放进一个 `aria-live="polite"` 的隐藏节点）。
- `disabled` 额外给内容元素 `aria-disabled="true"` + `tabindex="-1"`（`contenteditable="false"`
  由 `EditorView.editable` 自己管）。

## 尺寸

横向 / 纵向单位遵守仓库约定（横向 `ch`、纵向 `lh`）：`rows` → `min-height: N * 1lh`，
CM 主题里字号取 `--gpen-font-size`、行高取 `--gpen-line-height`，所以 `1lh` 只由控件自己决定，
与宿主页的 `line-height` 无关。边框 / 圆角 / 焦点环都用 `--gpen-*` token。

## demo 与测试

- `src/routes/demo/code/+page.svelte`：CodeEditor 部分演示双向绑定、占位符、表单提交
  （打印 `FormData`）、`disabled` / `readonly`、超长拒绝、`extensions` 注入 `numberStepper`
  （同一页面另有一节直接演示 `numberStepper` / `numberScrubber` 两个扩展）。
- `tests/e2e/code-editor.e2e.ts`：绑定与换行、外部改值后的 undo、`FormData` / `required` /
  `disabled` / `readonly`、`maxlength` 的键入与粘贴、占位符、扩展注入。
