# 笔画最小写入路径（T4）

「画一笔 → 写进协议文档 → undo → gpenBinary 存取」的最小闭环。刻意不做的：橡皮 / 填充 /
压感曲线 / 多帧时间轴 / 画笔预设 / 虚拟化 / 笔画选择与命中测试（见文末「已知缺口」）。

相关实现：`layers/strokeOps.ts`（纯数据写入）、`layers/layerView.ts`（坐标映射）、
`canvas/strokeCanvas.ts`（指针 + 渲染）、`components/areas/Viewport.svelte`（画布挂载）、
`components/GpenWorkspace.svelte`（提交 / undo / 落盘）。

## 数据落点（协议）

一笔写进 `Gpen.drawings`，由 `Layer.frames[].drawingIndex` 索引（见 `../gpen-protocol`
的 `drawing.tsp` / `layer.tsp`）：

```
Gpen.drawings: DrawingSlot[]        DrawingSlot.drawing.strokes: Stroke[]
Layer.frames:  Frame[]              Frame.drawingIndex -> drawings[i]
```

所以「写一笔」= ① active node 是可画层（`mimeType = application/gpen`）→ ② 该层有一个
`Frame`（默认 `frameNumber = 0`）→ ③ `drawings[frame.drawingIndex]` 有 `Drawing` →
④ push `StrokeT`。缺 Frame / Drawing 会自动补齐，所以「在默认（web 层）文档上直接画」
也能工作：`commitStroke` 先调 `layerOps.ensureDrawableActiveLayer` 建出并选中 `Stroke-N`。

`Stroke` 的最小默认值：`curve_type = POLY`、`start/end_cap = ROUND`、`softness = 0`、
每点 `radius = 2`、`pressure = 1`、`opacity = 1`、`id` 用 `crypto.randomUUID()`（失败退
计数器）。点坐标是**图层局部坐标**，不是 client 坐标（见下）。

## 写入 API（纯函数）

`layers/strokeOps.ts`，全部返回新文档，不原地修改，便于 undo 快照与单测：

| 函数 | 语义 |
| --- | --- |
| `createStroke(points, options?)` | 由局部坐标采样点造 `StrokeT`；给默认值、生成 id |
| `appendStroke(document, stroke, { frameNumber? })` | 追加到 active 可画层；active 不是可画层时 `throw RangeError`；补齐 Frame / Drawing |
| `strokesOfLayer(document, layer)` | 渲染用：按 `frameNumber` 升序遍历 frames，同一 drawing 只出一次 |
| `strokesOfDocument(document)` | 所有可画层的笔画（web 层跳过） |
| `activeDrawableLayer(document)` | active node 对应的可画层，否则 `undefined` |

## 坐标映射

真值 = 图层局部坐标；client / 文档坐标只是投影（`LayerView` 的约定）。`createLayerView`
在建立时（以及每次 `setRotation`）用「去掉 rotate 后量一次 `getBoundingClientRect`」的同一
个 task 捕获：

- `pivot`：旋转那一刻**视口中心**对应的图层局部坐标（`pivotAtViewportCenter`）；
- `origin`：元素在**文档坐标**下的原点 `rect.left + scrollX, rect.top + scrollY`；
- `scroll`：调用映射时**实时**读的 `window.scrollX/scrollY`。

公式（`mapLayerPoint` / `unmapClientPoint`，纯函数 + 单测）：

```
layerToClient(L) = origin - scroll + pivot + R(θ)·(L - pivot)
clientToLayer(c) = pivot + R(-θ)·(c - (origin - scroll) - pivot)
R(θ)·(dx,dy)   = (dx·cosθ - dy·sinθ, dx·sinθ + dy·cosθ)     // y 向下的 CSS 约定
```

⚠️ 相对 `tmp/handoff.md` 的公式补了 `+ pivot`：枢轴旋转的错切中心是 `pivot`，不是
元素原点；少了这一项在 `θ = 0` 时会整体偏移 `-pivot`，只有 `pivot = (0,0)` 才碰巧正确。

θ = 0 也能映射（`createLayerView` 立即以 `setRotation(0)` 捕获一次），所以滚动 / resize 后
画的笔画不会错位。canvas target（没找到 web 图层时）没有 DOM 可量：退回
`origin = pivot = (0,0)`、以文档原点为枢轴，这是**已知缺口**（见下）。

## 画布

`areas/Viewport.svelte` 里的 `<canvas class="stroke-surface">`：绝对定位铺满视口洞、
`pointer-events: auto`、`touch-action: none`、DPR 缩放、`z-index: 0` 在 minimap /
旋转控件（`z-index: 1`）之下。

- **指针**：`pointerdown` 起笔（`setPointerCapture` + `preventDefault`，避免变成文本选择 /
  点击），`pointermove` 按 `MIN_POINT_DISTANCE = 2px` 去抖追加，`pointerup` / `pointercancel`
  提交（取消也提交：已画出的墨迹不应默默消失）。
- **渲染**：把每点经 `LayerView.toClientPoint` 映射回 client 坐标再减去 canvas rect，
  所以笔画跟着（可能旋转的）图层走；`ctx` 以 DPR 变换。颜色取 `--gpen-panel-accent`
  （读不到时用常量兜底），线宽逐段用 `point.radius`。
- **重绘**：文档 / 旋转变化由 `Viewport` 的 `$effect` 触发；滚动 / resize 由 canvas 内部
  订阅 `observeViewport` + `ResizeObserver`。
- **滚轮不拦**：相机是原生滚动，滚轮冒泡去滚页面就是平移（`docs/layer-view.md`）。

## undo 模型

历史实现在 `lib/history.ts`（`createEditHistory<T>`），**不是** `Array` + `shift()`：

- **环形缓冲**：`{items, head, length}`，`commit` / `undo` / `redo` 都是 O(1)，丢弃最旧
  历史只推进 `head`，永远不搬数组（`shift()` 在大数组上是 O(n)，而且它按**条数**丢弃，
  小文档 50 份和大文档 50 份的成本一样）。
- **预算是条目数**：`limit`（默认 50）是环容量，`maxEntries` 是额外的硬上限（取更紧的）。
  文档快照是不可变引用，所以「同时存活的文档份数」就是真正的内存压力；如果以后某类历史项
  自带重负载（如位图），用 `onEvict` 回调在那里释放。
- **可合并**：`commit(state, { coalesceWith })` 用新值替换最新一条，而不是新推一条。
  连续的拖拽类编辑应该走这条（当前笔画是离散提交，用不上）。
- `redo` 是普通数组（同样受预算约束、每次新提交都被清空），所以它不会无限增长。

`GpenWorkspace` 的接线：提交前 `pushUndo(current)`（`commitStroke` / `renameNode` /
`moveNodes`），`undo` / `redo` 交换状态；**不**参与的：选中图层（`setActiveNode`，视图态
不是文档编辑）。`load` 到存档时会 `history.clear()`——否则 `Ctrl+Z` 会退回到那个临时的
默认文档。

- 键位：`Ctrl/Cmd+Z` 撤销，`Ctrl+Shift+Z` 或 `Ctrl+Y` 重做；焦点在 `input` / `textarea` /
  `contenteditable`（CodeMirror）里时让给控件自己的撤销栈。
- 入口：状态栏左侧的撤销/重做按钮（可用状态与深度由 `historyState` 驱动，`history` 本身
  不是响应式的）+ 可撤销步数显示。

## gpenBinary 接线

文档 id 固定 `gpen-main`，`createRuntimeStorage()` + `createGpenBinaryStore({ kv, blob,
cache: true, debounceMs: 250 })`：

- **挂载**：先用 `createDefaultGpen(location.href)` 把 UI 立起来，再异步 `load()`；读到存档
  就替换。用户在 load 期间画过（`documentEdited`）就不覆盖。
- **落盘**：`documentReady`（load 结束）之后，`gpenDocument` 每次变化都 debounce `save`。
  load 完成前不写，否则默认文档会先覆盖存档。
- **卸载**：`commit()`（刷挂起写入）→ `dispose()` → `storage.close()`。
- **KV 根分开**：工作区偏好与文档各用一份 KV 根（`kvKey = "gpen-root"` vs 默认 `"root"`）。
  `createKvStorage` 每个实例持有一份内存根、`submit()` 整根写回，共用根会互相覆盖
  命名空间，所以不能共用。
- **Blob 回落**：`createRuntimeStorage` 的 Blob 默认先试 OPFS broker
  （`targetDomain` 默认 `https://xxx.github.com/storage-broker`）。该域名不可达时 penpal
  握手 10s 超时后才回落到当前 origin 的 IndexedDB；同一页面复用回落结果，但 reload 后会
  再等一次 10s。e2e 因此把首次读 / 写的 poll 超时调到 25s（`docs/storage.md`）。

## 已知缺口（本轮明确不做）

- **压感曲线**：只存 `pressure`，渲染是等宽（逐段 radius），不按压力改宽度 / 透明度。
- **擦除 / 填充 / 笔刷预设 / 多帧时间轴**：都没有。`appendStroke` 支持 `frameNumber`，
  但没有帧管理 UI。
- **笔画选择 / hit-test / 编辑**：没有对象选择层，画布只是「纸」。
- **canvas target 的坐标映射**：没有 web 图层时 `origin = pivot = (0,0)`，滚动跟随正确但
  旋转绕文档原点而不是视口中心。
- **沉浸模式不铺满**：进入沉浸模式只隐藏 chrome，洞仍只占 dockview 原来给视口的那一格
  （网格没变），画布不会扩到整个可视区。
- **多图层渲染**：`strokesOfDocument` 把所有可画层的笔画用**同一个** `LayerView` 投影，
  忽略每层自己的 `transform` / `parent_inverse`（最小路径只有一个可画层，够用）。
- **层叠关系**：画布在宿主网页之上（同 origin 的 overlay），绘制模式下指针不再穿透；
  「交还网页」= 最小化（见 `tests/embed/embed.e2e.ts`）。
- **性能**：每次 redraw 全量重画，没有脏矩形 / 分层缓存 / 虚拟化。
- **历史未持久化**：刷新后历史清空（只持久化文档本身）。
