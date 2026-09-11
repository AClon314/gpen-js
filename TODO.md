# gpen-js 开发路线（TODO）

> 目标：把 Blender Grease Pencil 搬到 Web —— 悬浮球进入 Blender 式 Dockview 界面，
> 网页作为可绘制画布（中央可滚动网页 + 四周 gpen 面板），跨 origin 用可信 storage broker 持久化。
> 界面参考 `docs/blender.png`；决策记录见文末「设计决策」。

---

## 已完成（里程碑）

- [x] **工程底座**
  - [x] wxt 框架（manifest v3：chrome/firefox/safari）+ vscode/website 测试
  - [x] 搭建真实环境 + CI 自动化（根仓库 `scripts/ci.sh` + `.github/workflows/ci.yml`）
- [x] **crossTabBus** 消息层（同源 BroadcastChannel + 跨源 Penpal，`createTabBus` 自动选择）
- [x] **storage 数据层**（OPFS 跨 tab、blob→kv 同步、upDownloader）
  - [x] `bindBlobToKv` / `createBlobKvSyncHooks` / `submit()` / 动态 proxy hooks
  - [x] `createRuntimeStorage` / `createGpenBinaryStore`（FBS-005：blob 存 bin、kv 存版本化 metadata）
  - [x] `/storage-broker` 页面（跨 origin OPFS broker）+ `docs/storage.md` 契约
- [x] **FlatBuffers 协议接入**（FBS-001..008）
  - [x] TypeSpec → proto → fbs → TS accessor → fixtures 生成链 + buf lint + generated diff
  - [x] 直接用生成的 `GpenT`，撤掉手写 validator；三层（文档/toolbar+session/workspace+UI）内嵌 `Gpen`
  - [x] gpen-zig 同步、fixtures、跨端一致性（gpen-protocol 分层：`v1/` 放 math/brush/curve/keyMap/material/workspace，`v1/gpen/` 放 GP 本体）
- [x] **Blender 式 dockview 界面骨架**（P0 主体）
  - [x] 悬浮球 → 全屏 Blender 式界面（`GpenOverlay.svelte`）
  - [x] 四周布局（`GpenWorkspace.svelte` + `blender/` 各面板）
  - [x] `uiScale`（CSS `zoom` 作用于 dockview 容器，对齐 `bpy...ui_scale`，默认 1.0，范围 [0.5,2]）
  - [x] 图层树 adapter / 基础 layerOps（`layers/`）
- [x] **web-component 评估**（暂不引入 Spectrum；`gpen-panel` 折叠/恢复/slot/事件）

---

## 当前阶段

### P0｜界面收尾与图层/工具模型（使假界面接近可用）

> 大多数据骨架已搭好，以下是把「假界面」推进到「能编辑工具/图层」的收尾。

**A. 宿主与页面形态**
- [ ] 网页 DOM 操作：拖/缩/旋用 Moveable，与 gpen overlay 的 pointer capture / z-index / 事件透传边界明确（避免两套拖动系统抢同一手势）。
- [ ] 中央网页视口细节：滚动、缩放、坐标系、`visual viewport` / safe-area / 软键盘 / iframe / webview 裁切。

**B. 图层模型（协议 + UI，需 `type` 字段）**
- [ ] 协议给图层加 `type`：`html`（网页层）/ `gpen`（绘制层，canonical）。`svg` 作为视图/导出格式（后期），不作 `type`。
- [ ] `backend`（渲染后端 `svg|wgpu`）与语义 `type` 分开；未来 gpen-zig 用 `wgpu` 时放 `backend`。
- [ ] 默认网页层：进入即存在 `type=html` 层，层名=完整 URL（含前缀），默认选中，**不可直接绘制**。
- [ ] 画笔/创建工具：在被选中且不可绘制层上方新建 `Stroke-<自增>`，自动选中。
- [ ] 创建与选中分离：独立 create/select API（不隐式耦合）。
- [ ] 图层树：`nodes/layers/groups/active_node_index`（FBS-007 已对齐）；树顺序与 CSS z-index 分离（协议为准）。
- [ ] 渲染器：document-anchored，随网页滚动；z-index band 低于 Dockview fixed workspace。

**C. bpy API 对齐（命名 + vendor 再同步）**
- [ ] 图层操作命名贴近 bpy：`createLayer`（= `layer_add`，唯一参数 layer 名，内部移动+set active+插 keyframe）、`layer_remove` / `layer_select` / `layer_rename` / `layer_move`（重排/重父级）/ `layer_duplicate`。
- [ ] 图层属性对齐 bpy：`hide` / `lock` / `opacity` / `blend_mode` / `show_in_front` / `color` / `active` / `frame`；group 与 tree node、父级结构。
- [ ] 从 vendor/blender-upbge 再同步一次字段：以 `DNA_grease_pencil_types.h`、`rna_grease_pencil.cc/api.cc`、`BKE_grease_pencil.hh` 为准（先改 `.tsp` 仅追加，再重生成）。

**D. 工具与交互（落到可编辑）**
- [ ] [鼠标] 交互模式：选中时事件交给网页（释放控制权）。
- [ ] [画笔] 拦截事件，stroke 附着网页、随滚动；坐标模型统一 viewport/document/CSS pixel；稳定 id、增量渲染、undo/redo、序列化；防误触（笔>触摸>鼠标，pointerId/pointerType 仲裁）。
- [ ] [橡皮] stroke/point 命中，容差/变换/隐藏锁定/z-order；`disolve` 保持 disabled。
- [ ] [套索] 暂 disabled（保留协议身份）。
- [ ] [图层] 图层面板：增删改排/重命名/复制/重父级；active/flags/blend/opacity/masks/transform/parent/树顺序状态机；空与不可编辑态也要 UI。
- [ ] 切换粗细与颜色（颜色格式、min/max 粗细、单位、压力映射与预设）。

**E. 界面缩放微调**
- [ ] 只提供 UI 设置入口（放大/缩小/重置 + 数字输入），持久化 `uiScale`（默认 1.0）。

---

### P1｜可信 storage origin → 真实会话（当前推进主线）

> 已部署可信 origin：`https://blog.nolca.workers.dev/`（CF Pages，承载 `/storage-broker` 的 OPFS broker）。
> 假界面 `GpenOverlay/GpenWorkspace` 的 `onMount` 目前用 `createDefaultGpen(url)` 造假文档，**未接真实存储**。

**主线（基本线性，标注可并行点）**

```
[1] 可信 origin 接入 storage target
      │  改 DEFAULT_BLOB_TARGET_DOMAIN 或 createRuntimeStorage({ targetDomain })
      │  → 指向 blog.nolca.workers.dev 让 Blob 走其 OPFS broker
      ▼
[2] 构建 GpenBinaryStore 实例（持久化句柄）     ← 并行：[2a] 编码/解码链路已就绪（FBS-005）只验收
      │                                                [2b] 文档 id 分配（uuid / uri）可与 [3] 并行设计
      ▼
[3] 文档会话模型（open ⟷ session）
      │  load(id)→decodeGpen；save(id, GpenT)→debounce
      │  （从 createDefaultGpen 演进为“按 URL 建默认 web 层 + real session”）
      ▼
[4] 假界面接真实会话（替换 createDefaultGpen 硬编码）
      │  GpenWorkspace/BlenderViewport/LayerPanel → 读 session 的 layerTree/tools/session
      ▼
[5] doc → UI 桥（layerTree adapter + toolbar/workspace state 展开）
      ▼
[6] 编辑行为落 session（createLayer/select/stroke → 写 GpenT → debounced save）
      ▼
[7] 跨 origin / 跨 tab 同步（crossTabBus：同 session 多 tab、编辑事件转发、防崩溃）
```

**并行点（同意：主线需串行，这几处可并行）**
- [2a] 编码/解码链路验收（FBS-005 已就绪）。
- [2b] 文档 id 分配策略（可与 [3] 并行设计）。
- [4] 纯 UI 展示（LayerPanel 读已给 layerTree）可与 [5] 并行，但“接真实会话”须先有 [3]。

**当前待办（下一步抓手）**
- [ ] 确定 origin 接入方式：改全局 `DEFAULT_BLOB_TARGET_DOMAIN` vs demo 页传参（推荐先后者，隔离）。
- [ ] 验证 `blog.nolca.workers.dev/storage-broker` 部署就绪（返回 `{status:"ready"}`；parentOrigin/channel/timeout 参数符合契约）。
- [ ] 搭 `/demo/doc-editor` 或复用 GpenOverlay 假界面接真实 session（[3]+[4] 落地验证）。

---

### P2｜部署 / 多标签页 / 跨 origin 协作容器形态

> 来自早期零散笔记（09-04 的 cf pages / 单标签 / 多标签 / 反向缩放），归位到这里。

**A. 部署策略**
- [ ] CF Pages 作为**中转 cache**，不存敏感数据；持久性数据优先落到各 origin（可信域名实例）。
- [ ] 明确各 origin 的信任关系与存储归属（跨 origin 数据的「家」在哪）。

**B. 单标签页模式**
- [ ] 单标签页：gpen 界面反向缩放背景网页（viewport 用 `zoom: 1/Z` 抵消浏览器缩放，见 `demo/zoom`）。

**C. 多标签页 / 防崩溃 / 事件转发**
- [ ] 多标签页协同：同 session 多 tab 打开、编辑事件转发（crossTabBus）。
- [ ] 防崩溃：策略性 page lifecycle / 编辑基线稳定（万一崩溃可恢复）。
- [ ] 跨 origin 持久化与同步：`storage-broker` 跨 origin 读写一致性（docs/storage.md 契约为准）。

---

## 设计决策（记录）

- **svg vs gpen**：gpen 为 canonical/存储类型（定型数值字段、跨 JS/Zig、GPU 友好、增量更新）；SVG 为视图/导出格式（`gpen→SVG` exporter，压力/半径/动画/修饰符映射有损，规则待定）。
- **type 语义**：`html`/`gpen`；`wgpu` 放独立 `backend`，不入 `type`。
- **uiScale**：对齐 `bpy.context.preferences.view.ui_scale`；Dockview 用 CSS `zoom`（px 布局一致缩放、ResizeObserver 自洽、事件坐标一致；Firefox 126+ 支持）；不用 `font-size`（部分缩放）或 `transform: scale`（overlay/getBoundingClientRect 错位风险）。
- **storage 泛型**：KV 存 JSON、Blob 存二进制；两 backend 不组跨存储事务；`createGpenBinaryStore` 先写 blob 再写 metadata，失败用 `size_mismatch` 诊断而非静默半写。
- **协议分层**（gpen-protocol）：`v1/` 放非 GP 领域（math/brush/curve/keyMap/material/workspace），`v1/gpen/` 放 GP 本体（gpen/gpen_data/drawing/layer/onion/stroke）；聚合入口 `gpen/gpen.tsp`；生成物路径由 `@package gpen.v1` 决定。
- **目录勘察**：陌生仓库先 `tree` 建立地图再深入，不递归倾倒；vendor/源码符号链接用 `readlink -f` 解析。

## 参考文档

- 界面与图层 UX：`docs/panel.md`
- 协议边界：`docs/flatbuffers.md`
- storage 契约：`docs/storage.md`、`src/routes/storage-broker/+page.svelte`
- web-component 评估：`docs/web-components.md`
- 界面示意：`docs/blender.png`
