# CodeArea（可编辑文本 × 数据同步的外壳）

`src/lib/components/areas/CodeArea.svelte` + `src/lib/components/codeArea/`。

CodeArea 是 workspace 里的一块「文本面板」：默认当 **viewport 组的新 tab** 打开（VSCode 打开文件
那种感觉），内容是 `CodeEditor`，数据来自一个注册过的 **`CodeAreaSource`**。

它和 [`CodeEditor`](code-editor.md) 的分工：CodeEditor 是 **widget**（受控文本框，值一变就写回
绑定），CodeArea 是 **area**（决定这块文本读什么、写回哪、什么时候提交）。

```svelte
<!-- 调用方（Svelte）只面对两个可绑定通道 -->
<CodeArea bind:value={model.text} source={source} />
```

## 两条通道：`value` 是提交值，`realtimeValue` 是实时值

| prop            | 语义                           | 什么时候变                          |
| --------------- | ------------------------------ | ----------------------------------- |
| `value`         | **提交值**（外部绑定优先用它） | 用户点「提交」/ 在面板里按 `Ctrl+S` |
| `realtimeValue` | **实时值**                     | 每次按键                            |

实时快照落进编辑器是**去抖**的（`LIVE_DEBOUNCE_MS = 250`）：一次更新 = 一次 CodeMirror 变更 +
重排，这是整条链路上最贵的一步；预览时拖滑条 / pinch / 滚动会高频改状态，不需要每帧落一次
（首屏仍然立即显示，面板不会空白半秒）。

⚠️ 这和仓库其他控件**相反**：`Input` / `InputNumber` / `InputSlider` / `CodeEditor` 的 `value`
都是实时值。`CodeArea` 包着的正是 `CodeEditor`，两个名字一字之差、语义相反，所以这里显式写死：
**要每次按键就用 `realtimeValue`**。

为什么要有提交通道：`CodeEditor` 是受控组件，每敲一个字符就写回绑定值。如果直接把 `value` 绑到
「会被序列化 / 进 undo 栈」的地方，一次输入就是一次编辑（保存风暴 + undo 栈爆炸）。CodeArea 的
`draft / committed` 两层就是为此存在的：

```text
source.read() ──(实时，读 $state)──► 格式化文本 ──► draft ──bind:value──► CodeEditor
                                                       │
                              value(提交值) ◄── 提交 ───┤
                         realtimeValue(实时值) ◄── 按键 ┘
```

两条实现约束（踩过就当规范）：

1. **提交只发生在事件处理器里**（按钮 / `Ctrl+S`）。**不要**写成「draft 一变就回写 `value`」的
   `$effect`——那是 `effect_update_depth_exceeded`（偏好设置面板踩过同一类）。
2. `value` / `realtimeValue` 都要 `Object.is` 回声守卫（`CodeEditor` 里已有同款）。

## 数据源：`CodeAreaSource`

```ts
interface CodeAreaSource {
  id: string; // 稳定 id → 面板 id `codearea:<id>`，同源只开一个 tab
  title: string; // tab 标题
  read(): unknown; // 同步读取
  load?(): Promise<Record<string, unknown>>; // 可选：异步补充，浅合并到同一棵 JSON 树
  write?(text: string): void; // 有它就是可编辑；没有则只读
}
```

- **实时怎么来**：`read()` 在组件的 `$derived` 里调用。只要它内部读的是 Svelte `$state`
  （`preferences()`、`menuState`、任何 `$state` 对象），Svelte 自己就会订阅 → 自动刷新，
  **不需要轮询，也不需要订阅机制**；高频值（滚动 / pinch 平移）靠一个 `$state` 计数器推进
  （内置源用 `GpenWorkspace` 的 `viewportRevision`），限频交给上面的去抖。
- **异步怎么来**：`load()` 只在打开面板与点「刷新」时各跑一次（KV / blob 这类一次性快照）。
  两个通道刻意分开：把 `await` 混进实时路径会让「实时」变成「猜什么时候更新」。
- 注册表是命令式的（`registerCodeAreaSource` 返回注销函数），与 `contextMenu.svelte.ts` 同款：
  面板是命令式打开的，源的增删不需要驱动渲染。
- 源的 `read()` 抛错会被兜住并渲染成 `{ error }` 树（调试源不该把整个布局带崩）。

## 滚动与 caret

- **编辑器自己滚**：面板里的 flex 链（`.codearea-editor → .code-editor → .code-editor__host →
  .cm-editor → .cm-scroller`）每一层都要 `flex-direction: column` + `min-height: 0`。少一层
  （尤其 `__host`）CM 的高度就会等于内容高度，`.cm-scroller` 不溢出，滚轮直接穿透到底下的
  web layer —— 用户看到的是「代码滚不动、页面在滚」。
- **更新不抢位置**：实时更新走 `CodeEditor` 的 `preserveViewOnExternalChange`（见
  [`code-editor.md`](code-editor.md)），caret 与滚动位置都留在原地。

## 打开与关闭

- **位置**：`addPanel({ position: { referencePanel: 'viewport', direction: 'within' } })` ——
  同一个 `viewport` 组的**新 tab**，不是新组，所以不动网格布局。
- **幂等**：同 `sourceId` 再开一次 = `panel.api.setActive()`。
- **「洞」不用改**：`markHoleGroup()` 按 active panel 打标记，实测切到 CodeArea tab 后那一组
  不再是洞（变成普通不透明 chrome、宿主网页不再透出），切回视口又变回洞。
- **关闭入口**：其他 tab 的关闭按钮被 `themes/dockview.css` 统一藏掉了（tab 条当 area header 用），
  CodeArea 是「文件 tab」，所以按 `data-tab-panel-id` 前缀单独放回来；右键菜单里的「关闭」照旧。

## 不跨会话保留（明确取舍）

CodeArea 面板**不进「还原的布局」**。原因：数据源是活的 JS 对象（内存快照、调试视图），重载后
重建不出来；而且 `panelLayout` 一持久化，用户关掉过的调试 tab 会一个接一个复活。

dockview 的 `toJSON()` 没有 per-panel 开关，所以实现是**还原之后把它们摘掉**
（`GpenWorkspace.dropRestoredCodeAreas()`），紧接着的布局变更会把干净版本写回存储。代价：存储里
确实有 CodeArea 时，还原会先挂载再卸载一次（短暂的 CodeMirror 实例）。

## 已知缺口

- **外部变更 + 未提交 → 提示**：还没做。现在的规则是「没动过才跟随实时值，动过就不覆盖」——
  不丢用户输入，但也不会问「要不要用新的」。等出现真正可写的数据源再定规则（那时才需要
  `lib/` 里的纯状态机）。
- **大文本**：`formatDebugValue()` 有 `maxLength`（默认 12 万字符）与 `maxEntries`/`maxDepth`
  上限，超出会在工具栏显示「已截断 / 省略 N 项」。放开的代价是 CodeMirror 会卡。
- **`Ctrl+S` 只提交本面板**：工作区的 `Ctrl+S`（保存文档）会跳过文本输入目标，所以焦点在
  CodeArea 里时按它只提交这块文本。

## 内置：「调试：内部 JSON 状态树」

文件菜单里的 `调试：内部 JSON 状态树`（命令 `gpen.debug_internal_json_state`）打开的就是
`codeArea/internalState.ts` 注册的源，取代了原来的「导出 JSON」菜单项：

- 同步（实时）：`workspaceState` / `preferences`（各自就是会被写进 KV 的那份载荷）、
  `document`（计数与状态，不是整篇文档）、`viewport`（`uiScale` / `externalZoom` /
  `workspaceZoom` / `dpr` / 容器未缩放尺寸 / `visualViewport` / `window` 滚动量 / `document`
  滚动范围 / overlay·右键菜单·spacer 的 inline 定位与视觉矩形）、`menu`（右键菜单状态）。
- 异步（`load`，按「刷新」重读）：`gpenBinary` 的 KV —— `kvName`、根键、`gpen.<id>` 元数据。

`viewport` 一节是排查「缩放相关 bug」的入口：菜单尺寸不对、sash 增量不对时，先看
`workspaceZoom` 与 `visualViewport.scale` 是否等于 1。它**不藏数据**：`scrollX/scrollY` 这些
每帧都在变的数字也在里面，限频由 CodeArea 的去抖负责（`read()` 仍然在 `$derived` 里，滚动由
`viewportRevision` 这个 `$state` 计数器推进）。
