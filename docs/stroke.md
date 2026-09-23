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
- **多图层渲染**：`strokesOfDocument` 把所有可画层的笔画用**同一个** `LayerView` 投影，
  忽略每层自己的 `transform` / `parent_inverse`（最小路径只有一个可画层，够用）。
- **层叠关系**：画布在宿主网页之上（同 origin 的 overlay），绘制模式下指针不再穿透；
  「交还网页」= 工具 rail 的 `page`（网页交互）工具；隐藏面板用右上角最小化。
- **性能**：每次 redraw 全量重画，没有脏矩形 / 分层缓存 / 虚拟化。
- **历史未持久化**：刷新后历史清空（只持久化文档本身）。

## 橡皮（T11）与画笔参数（T10）（2026-09-19）

### 工具参数住在文档里

`Gpen.toolbarState`（协议 field 10）是画笔 / 橡皮参数的真值：
`layers` 之外的 `components/toolbarOps.ts` 负责读写（`defaultToolbarState()` /
`readToolbarState()` / `writeToolbarState()` / `writeBrushSettings()` / `writeEraserSettings()`）。

`activeTool` 有两个家，只有一个主人：

- `workspaceState.activeTool`（工作区 KV）是 **UI 真值**——工具轨高亮它、reload 后还是它；
- `ToolbarState.activeToolId` 是**镜像**，写文档时同步一份。

镜像**单向**：`readToolbarState` 绝不覆盖 UI 的当前选择（载入文档不该抢用户手上的工具）。

⚠️ **`BrushSettings.size` 是直径、`Point.radius` 是半径**：换算只在 `brushRadiusOf()` /
`eraserRadiusOf()` 里做一次（`size / 2`），调用方不要自己除。

### 三种擦除模式（与枚举名相反！）

`EraserMode` 的**名字会骗人**，以 `vendor/upbge-blender/.../grease_pencil/erase.cc` 为准：

| `EraserMode` | Blender UI 名 | gpen 实现 | 语义 |
| --- | --- | --- | --- |
| `SOFT` (0) | Dissolve | `eraseSoft` | smoothstep falloff 逐点降 `Point.opacity`，降到 `0.05` 以下删点 |
| `HARD` (1) | Point | `eraseHard` | 折线与圆求交，圆内部分切掉，圆外各段成为**新笔画**（新 `Stroke.id`） |
| `STROKE` (2) | Stroke | `eraseStrokes` | 点到折线距离 ≤ 半径 → **整笔删除** |

所以实现顺序是 STROKE → SOFT → HARD（最简单到最难），不是反过来。

- **`EraserTarget` 已 deprecated**：`mode` 是唯一真值，代码里**不做任何 `target` 分支**。
  `defaultToolbarState()` 照写 `target`（保证旧读端能理解），新代码不写。派生关系见
  `../gpen-protocol/protocol/v1/brush.tsp`。
- **几何**：`distanceToStroke`（点到**线段**距离，投影参数 clamp 到 `[0,1]`，零长线段退化为点距，
  平方比较只开一次方）与 `strokesHitByCircle`。同一块积木将来给套索复用。
- **只擦当前层**（`EraserFlags.active_layer_only`，Blender 默认）：跨层擦除**没做**。
  在 web 层 / 非可画层上拖动是 no-op，不是报错。
- **不可变 + 引用共享**：全部返回新文档；未命中的笔画原样返回引用
  （`eraseHard(doc, ...) === doc` 在不命中时成立）。`mapLayerStrokes` 按 `drawingIndex`
  去重，所以一个 drawing 被多帧引用时只擦一次。
- **一次拖动 = 一条 undo**：橡皮是连续手势，`commitErase` 在**手势第一步**
  `pushUndo(previous)`（推入拖动之前的文档），之后每一步才 `{ coalesceWith }` 合并到它，
  Ctrl+Z 一次退回拖动之前。**手势边界（pointerup / cancel）必须清掉合并目标**
  （`endEraseGesture`）：第一步也走 coalesce 的话，`coalesceWith`（它是「替换最新一条」）
  会把上一步动作的条目吃掉；不清合并目标的话，两次独立拖动会共用同一条。
  回归：`tests/e2e/eraser.e2e.ts` 的「two separate eraser drags are two undo steps」。
- **画布只上报采样点**：`strokeCanvas` 的 `onStroke(points)` / `onErase(point)` 给的是
  **图层局部坐标**；`GpenWorkspace.commitStroke` / `commitErase` 才把它们变成协议数据
  （画笔半径 / 颜色来自 `ToolbarState`，画布不拥有文档）。

### 已知缺口（本轮明确不做）

- **压感曲线**：`Point.pressure` 一直在写（`strokeCanvas.sample` 读 `event.pressure`），
  但渲染是等宽——**存了压力，画出来是等宽的**。
- **橡皮跨层**：见上（`active_layer_only`）。
- **橡皮性能**：画布是**全量重画**、没有笔画包围盒索引，STROKE/SOFT 每次 pointermove 都是
  O(strokes × points) 命中判断。几百笔没问题；要优化先加「笔画 AABB + 网格哈希」，
  不要先上脏矩形（脏矩形解决的是重绘，不是命中测试）。
- **笔刷预设目录 / `recentBrushPresetIds`**：字段在协议里，UI 没做。
- **`EraserSettings.strength_factor` / `thickness_factor`**：SOFT 用的是 `strength`，
  这两个 factor 还没接进 falloff 曲线。
