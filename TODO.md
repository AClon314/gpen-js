# gpen-js 开发路线（TODO）

> 参考示意图：`docs/blender.png`（Blender 2D Animation 界面）。信息搜集 findings 见
> `/tmp/luna-find-{bpy,uiscale,dockview,svggpen}.md`（瞬时，关键结论已并入下文）。

## 已完成

- [x] 搭建真实环境，CI 测试自动化
  - [x] 引入 wxt 框架简化 manifest v3（chrome/firefox/safari）
  - [x] vscode / website 测试
  - [ ] monkey 如何实现 CI？（仍待）
- [x] crossTabBus 消息传递层
- [x] storage 数据存储层（OPFS 跨 tab、blob→kv 同步、upDownloader 重构）
  - [x] `bindBlobToKv` / `createBlobKvSyncHooks`、`submit()`、动态 proxy hooks
- [x] **FlatBuffers 协议接入**（FBS-001..008，方案见 `docs/flatbuffers.md`）
  - [x] TypeSpec→proto→fbs→TS accessor→fixtures 生成链 + buf lint + generated diff
  - [x] 直接用生成的 `GpenT`，撤掉手写 validator；三层（文档/toolbar+session/workspace+UI）内嵌 `Gpen`
  - [x] gpen-zig 同步、fixtures、跨端一致性
  - [x] 根仓库 CI（`scripts/ci.sh` + `.github/workflows/ci.yml`）
- [x] web-component 评估（暂不引入 Spectrum；`gpen-panel` 折叠/恢复/slot/事件）

---

## 当前阶段：Blender 式 Dockview 界面 + 图层/工具模型（P0）

目标：复刻 `docs/blender.png` 的布局 —— **四周周边层 + 中央可滚动网页**。

### A. 宿主形态（悬浮球 → Blender 式界面）

- [ ] 默认 gpen 只是**吸附网页四周的悬浮球**；点击后进入全屏 Blender 式界面。
- [ ] Dockview 作为 `position: fixed` 的**悬浮层**，只布置在**四周**；中央是**可滚动的网页**（即 Blender 的 3D view / canvas）。
- [ ] 退出/收起回到悬浮球；网页文档流不被改变。

### B. 布局（对齐 blender.png）

- [ ] **顶部**：菜单栏 + 工具设置条（当前笔刷/尺寸 0.15m/强度 0.4 等）
- [ ] **左侧**：竖排工具条（画笔/橡皮/填充……；对齐 Blender 左侧 tool strip）
- [ ] **中央**：网页视口；处理滚动、缩放、坐标系、`visual viewport`/safe-area/软键盘/iframe/webview 裁切
- [ ] **右侧**：Outliner（图层树，对齐 Blender "场景集合"）+ 属性/笔刷/颜色
- [ ] **底部**：时间轴（dope sheet / 帧 / keyframe）+ 图层面板（对齐 Blender 层：混合模式/不透明度/灯光）
- [ ] **状态栏**：当前工具 / 层 / 帧 / 画布信息（对齐 Blender 底部状态）

### C. 界面缩放（独立 DPI / font-size 变量）

- [ ] 预留 `uiScale` 变量供用户调整，语义对齐 Blender **`bpy.context.preferences.view.ui_scale`**
      （float 倍率，默认 1.0，范围版本相关 [0.5,6]；注意**不是** `system.ui_scale`/`system.dpi`，后两者是 runtime 只读）。
- [ ] Dockview **无内置缩放**。采用 **CSS `zoom`** 作用于 dockview 容器（px 布局一致缩放、
      ResizeObserver 内容尺寸自洽、事件坐标一致；Firefox 126+ 已支持）。- 仅用 `font-size` 只能"部分缩放"（多数尺寸为硬编码 px）；`transform: scale` 有浮动
      overlay host / `getBoundingClientRect`↔`offsetWidth` 错位风险，不用于生产布局。
- [ ] 提供 UI 设置入口（放大/缩小/重置 + 数字输入），持久化为用户偏好（`uiScale` 默认 1.0）。

### D. 图层模型（协议 + UI）—— 新增 `type` 字段

- [ ] 协议给图层加 `type` 枚举：`html`（网页层）/ `gpen`（绘制层，canonical）。- `svg` 作为**视图/导出格式**（后期），不作为图层语义 `type`。
- [ ] **`backend`（渲染后端 `svg | wgpu`）与语义 `type` 分开**：未来 gpen-zig 若用 `wgpu`，
      放 `backend`，不塞进 `type`。
- [ ] **默认网页层**：每次进入界面，默认存在一个 `type=html` 图层，图层名 = **完整 URL
      （含 https? 前缀）**，默认**选中**，**该层不可直接绘制 stroke**。
- [ ] **用画笔/创建工具时**：自动在**被选中且不可绘制层上方**新建图层，层名 `Stroke-<自 1 递增>`，
      并**自动选中**新层。
- [ ] **创建与选中是独立操作**：提供独立的 create/select API（不做隐式耦合；bpy 的
      `layer_add` 内部会 set_active，但 Web 端应显式分离）。
- [ ] 图层树：`nodes/layers/groups/active_node_index`（已由 FBS-007 adapter 对齐）；
      树顺序与 CSS z-index 分离（协议为准）。
- [ ] 渲染器：document-anchored renderer 随网页滚动；z-index band 低于 Dockview fixed workspace。

### E. bpy API 对齐（命名 + vendor 再同步）

- [ ] 图层操作命名贴近 bpy：
      `bpy.ops.grease_pencil.layer_add(new_layer_name=...)`（唯一参数即 layer 名；内部会移到
      active layer 之后/进入 active group、set active、在当前帧插空 keyframe）→ Web 端 `createLayer`
      语义；对应 `layer_remove` / `layer_select` / `layer_rename` / `layer_move`(重排/重父级) /
      `layer_duplicate`。
- [ ] 图层属性名对齐 bpy（从 `GreasePencilTreeNode`/`GreasePencilLayer`/`GreasePencilLayerGroup`）：
      `hide` / `lock` / `opacity` / `blend_mode` / `show_in_front` / `color` / `active` / `frame` 等；
      group 与 tree node、父级结构。
- [ ] **从 vendor/blender-upbge 再同步一次字段**：以 `DNA_grease_pencil_types.h`、
      `rna_grease_pencil.cc`/`rna_grease_pencil_api.cc`、`BKE_grease_pencil.hh` 为准，对齐
      Layer/LayerGroup/LayerTreeNode 的持久字段与命名（先改 `.tsp`，仅追加，再重生成）。

### F. 工具行为（沿用 5 按钮，落到新布局）

- [ ] [鼠标] 交互模式：选中时鼠标/笔/触摸事件交给网页（释放控制权）。
- [ ] [画笔] 拦截事件，stroke 附着网页、随滚动；坐标模型统一 viewport/document/CSS pixel；
      稳定 id、增量渲染、undo/redo、序列化；防误触（笔>触摸>鼠标，pointerId/pointerType 仲裁）。
- [ ] [橡皮] stroke/point 命中，容差/变换/隐藏锁定/z-order；`disolve` 保持 disabled。
- [ ] [套索] 暂 disabled（保留协议身份）。
- [ ] [图层] 打开图层面板；增删改排/重命名/复制/重父级；active/选中/flags/blend/opacity/
      masks/transform/parent/树顺序状态机；空与不可编辑态也要 UI。
- [ ] 切换粗细与颜色（颜色格式、min/max 粗细、单位、压力映射与预设）。

### G. 网页 DOM 操作（非 gpen UI 面板）

- [ ] 拖/缩/旋网页 DOM 用 Moveable；与 gpen overlay 的 pointer capture、z-index、事件透传边界明确，
      避免两套拖动系统同时接管同一手势。

---

## 设计参考 / 决策记录

- 界面：`docs/blender.png`；布局与图层 UX：`docs/panel.md`；协议边界：`docs/flatbuffers.md`；
  web-component：`docs/web-components.md`。
- **svg vs gpen**：gpen 作为 canonical/存储类型（定型数值字段、跨 JS/Zig、GPU 友好、增量更新）；
  SVG 作为视图/导出格式（`gpen → SVG` exporter，压力/半径/动画/修饰符映射有损，规则待定）。
- **type 语义**：`html` / `gpen`；`wgpu` 放独立 `backend`（渲染后端），不入 `type`。
- **uiScale**：对齐 `bpy.context.preferences.view.ui_scale`，Dockview 用 CSS `zoom` 实现。
