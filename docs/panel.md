# Gpen 面板系统

状态：设计稿（2026-08-28）

## 下个版本范围

下个版本不实现独立的 dropzone/docking 引擎。若接入 Dockview，内部的 dropzone、panel docking、split、tab 重排和 docking preview 直接使用 Dockview 提供的能力，通过配置和少量 adapter 启用，不在 gpen 中重复实现。

Dockview 工作区作为网页上方的固定 UI 图层接入：网页是 VS Code tab 中的主要内容区域，网页滚动不应带走 Dockview 面板。下个版本同时建立最小可用的 gpen 图层模型，图层数据字段以 `../gpen-protocol/protocol/v1/gpen.tsp` 为准。

## 结论先行

目前没有一个可以直接解决 gpen 面板 UX 的库。现成库大致分成两类：

1. Moveable 负责拖拽、缩放、吸附、手势等几何问题；
2. Dockview 负责停靠树、分栏、标签组和浮动布局。

它们都不会替 gpen 决定工具栏如何把输入控制权交还网页、画笔如何贴合滚动页面、图层如何跟随文档上下文，或者收起后如何恢复焦点。因此面板的状态机、UX 和持久化格式必须由 gpen 自己掌握。

当前和后续建议分开处理：

- 下个版本以 Dockview 作为 gpen UI 的 workspace 容器，根节点使用 `position: fixed` 覆盖 visual viewport，不随网页 document scroll 移动；需要锚点避让、safe area 和 viewport 碰撞处理时，补充 `@floating-ui/dom`。
- Dockview 内部的 docking、split、tab 和 preview 由 Dockview 负责；gpen 只配置 `dndStrategy`、`dndEdges` 等选项，并通过公开事件接入业务状态。需要验证的是 adapter、生命周期、主题和持久化，而不是重新实现这些交互。
- 图层渲染与 Dockview UI 使用不同的 DOM 根和 z-index band：文档锚定的绘图/图层渲染可以随网页滚动，但永远不能提升到 Dockview UI 之上。
- 开始接入“可停靠的图层/属性工作区”时，做一个 Dockview vanilla TypeScript 原型。若它与 Svelte custom element、Shadow DOM、VS Code webview 和跨窗口生命周期不兼容，再评估 Lumino；不要让完整布局引擎反向成为 gpen 的数据模型。

## 候选库评估

维护信息按 2026-08-27 通过仓库 API 和项目主页核对；“活跃”只表示代码仍有近期活动，不代表它适合 gpen。

| 方案                                                            | 当前信号                                                                | 能解决什么                                                                                          | 主要缺口                                                                                         | 结论                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| [Dockview](https://github.com/mathuo/dockview)                  | v8.2.0 于 2026-08-19 发布，仓库 2026-08-21 仍有提交                     | vanilla TypeScript、tabs/groups、split/grid、dock、floating group、popout、序列化、触摸、Shadow DOM | 仍需自己接入 Svelte 生命周期、面板内容和 gpen 的输入/上下文语义；完整工作区会增加包体和 CSS 约束 | 最值得做 POC 的完整布局引擎                |
| [Lumino](https://github.com/jupyterlab/lumino)                  | v2026.7.3 于 2026-07-03 发布，2026-08-03 仍在修复 touch resizing        | `DockPanel`、`SplitPanel`、`TabBar`、拖放、widget 消息和桌面应用式布局                              | Jupyter 风格的 Widget/MessageLoop/Signal 模型较重；需要适配 Svelte 内容和自己的主题              | 功能成熟，作为 Dockview 的备选             |
| [Golden Layout](https://github.com/golden-layout/golden-layout) | v2.6.0 发布于 2022-09-26；master 2026-01 仍有提交，但 v3 dev 分支不稳定 | 多窗口、touch、保存/加载布局、拖放和主题                                                            | release 与主分支状态脱节；没有一等 Svelte 集成，v3 升级风险需要单独承担                          | 只在已有 v2 兼容性验证后考虑               |
| [Moveable](https://github.com/daybrush/moveable)                | 0.53.0 发布于 2023-12-03，仓库最近提交为 2024-06-03                     | draggable、resizable、scalable、groupable、snappable；有 Svelte wrapper                             | 近年发布节奏偏低；同样不提供 panel UX 和 docking                                                 | 不作为新核心依赖，除非只需要它的控制框能力 |
| [Floating UI](https://github.com/floating-ui/floating-ui)       | 2026-08-26 仍有提交，2026-07-11 有 release                              | anchor positioning、shift/flip/size 等碰撞处理、tooltip/popover 交互基础                            | 不负责拖拽、停靠、分栏、标签和工作区                                                             | 适合作为小型辅助依赖                       |
| [GridStack](https://github.com/gridstack/gridstack.js)          | v13.2.0 于 2026-08-20 发布                                              | dashboard 网格、响应式列、拖放和尺寸调整                                                            | 它的核心模型是网格 widget，不是 Adobe/Blender 的自由停靠、标签和面板树                           | 不适合 gpen 的主面板模型                   |

### 为什么 Dockview 仍不是“直接采用”

Dockview 是候选中最接近目标的方案，尤其是 vanilla TypeScript、浮动组、popout、布局序列化和 Shadow DOM 支持。但它解决的是 IDE/workbench 式布局，不是绘图工具的完整交互协议：

- 拖动面板标题时，gpen 还要区分“移动面板”和“操作网页/绘制 stroke”；
- dock preview 不能遮挡或吞掉网页内容的 pointer event；
- layer panel 的 active layer、锁定、可见性和文档上下文不应由布局引擎持有；
- popout window 在 iframe、userscript 和 VS Code webview 中可能被浏览器策略阻止；
- gpen 需要自己的布局版本迁移、焦点返回、键盘快捷键和 reduced-motion 策略。

因此 POC 应验证“能否作为 layout adapter”：确认配置、生命周期、主题、事件和持久化边界，而不是在 gpen 中重写 Dockview 已有的 panel API。

## 从 Blender 和 Adobe 借鉴的模型

参考：

- [Blender Areas](https://docs.blender.org/manual/en/latest/interface/window_system/areas.html)
- [Blender Regions](https://docs.blender.org/manual/en/latest/interface/window_system/regions.html)
- [Blender Tabs & Panels](https://docs.blender.org/manual/en/latest/interface/window_system/tabs_panels.html)
- [Adobe Spectrum Side navigation](https://spectrum.adobe.com/page/side-navigation/)
- [Adobe Photoshop panels and menus](https://helpx.adobe.com/photoshop/using/panels-menus.html)

### 分层概念

不要把“面板系统”当作一个带 `position: fixed` 的单独 div；Dockview workspace root 可以固定在 viewport 上方，但内部仍应按 workspace、area、region 和 panel 分层。建议使用下面的层次：

- **Workspace**：一组面板布局和工具上下文，例如绘画、图层整理或演示模式；可以按用户保存，也可以按文档保存。
- **Editor/Area**：占据主要空间的编辑区域。Blender 的 Area 可以被分割、合并、交换或最大化。
- **Region**：Area 内的 header、toolbar、sidebar、footer 等功能区域。Region 可以隐藏、调整大小或恢复为图标入口。
- **Panel**：Region 内的最小组织单元，有稳定标题、收起状态和内容；gpen 当前的 `<gpen-panel>` 属于这一层。
- **Panel group/stack**：多个面板以 tabs 或垂直堆叠方式共享一个区域。
- **Floating panel**：脱离 dock tree 但仍属于同一 workspace 的面板；它不应该变成一套不同的组件语义。

Blender 的关键经验是：Area、Region、Panel 的职责不同，且每个编辑器的快捷键由鼠标所在区域决定。Adobe 的关键经验是：面板可以停靠、分组、缩为图标、恢复工作区，并且面板内容会随当前工具、对象或上下文变化。

### 面板 header

header 必须始终可见，并且不能把所有操作藏在拖拽手势里。建议从左到右支持：

1. 可读的标题；
2. 可选的上下文/状态图标；
3. 可拖拽区域；
4. 收起/展开按钮；
5. 面板菜单（关闭、固定、停靠位置、重置等）。

具体规则：

- 点击标题或收起按钮可以切换展开状态；收起后保留一个有 accessible name 的图标入口；
- 拖动应从明确的 grip/header 区域开始，不能让按钮、文本选择和表单控件误触发拖动；
- header 的右键菜单提供与拖拽等价的操作，触摸设备不能依赖右键；
- 关闭、隐藏、收起、固定和从 workspace 移除是不同状态，不要用一个 `visible` 布尔值混在一起；
- 面板标题采用简短、稳定、句式大小写的文本；图标只在语义明确时使用，不能用图标代替所有文字。

### Collapse、hide、pin 的区别

| 状态           | 是否占空间          | 是否仍在当前布局        | 如何恢复         |
| -------------- | ------------------- | ----------------------- | ---------------- |
| expanded       | 是                  | 是                      | 收起或关闭       |
| collapsed/rail | 只保留图标或窄 rail | 是                      | 点击图标         |
| hidden         | 否                  | 是，仍在 workspace      | 面板菜单或工具栏 |
| pinned         | 取决于所在区域      | 跨 tab/context 继续显示 | 取消 pin         |
| closed         | 否                  | 否，实例被移除          | 面板菜单重新打开 |

Blender 的面板收起、批量展开/收起、排序 grip、pin 和 preset 值得保留为 gpen 的后续能力。Adobe 式“Collapse to Icons”适合窄屏和浮动工具栏，但图标必须有 tooltip、键盘名称和稳定的恢复位置。

### Resize 和 splitter

- 分隔条有独立的命中区，视觉宽度可以很细，但触摸命中区不能过小；hover、keyboard focus 和拖动中需要有明显状态；
- 调整尺寸时只改变同一 split branch 的相邻区域，不能让不相关面板跳动；
- 每个面板有 `minSize`、`maxSize`、`preferredSize`，内容过长时优先滚动，不把整个 workspace 撑出 viewport；
- 支持 double-click 恢复 preferred size，支持 reset layout；
- 尺寸拖动使用 pointer capture，遇到 `pointercancel`、窗口失焦或 Escape 必须回滚/结束；
- Blender 的 Ctrl snap、Shift 联动相邻边界可作为高级模式，但不能成为移动端唯一的精细调整手段。

### Dock、split、tab 和 float

拖动面板 header 时显示 dock preview，并把目标区域分成可理解的语义区：

- 中心：加入目标 stack，成为 tab；
- 上/下/左/右：在目标旁边创建 split；
- 当前 workspace 外：变为 floating panel；
- 无效区域：不显示 preview，不改变布局。

交互要求：

- preview 必须提前显示，且在 pointerup 前不提交布局；
- `Esc`、`RMB`、pointercancel 和拖出后返回原位都能取消；
- 拖动过程中不销毁 panel 内容，避免输入框、canvas 或 iframe 丢失状态；
- tab 支持激活、关闭、重排、溢出菜单、可选 pin 和 dirty 状态；
- stack 只有一个 active tab，键盘可以在 tab 与 panel body 之间稳定移动；
- layout tree 可序列化，且同一 panel 不允许同时出现在两个位置。

### Floating panel 的默认行为

工具栏和图层面板都应遵循同一套 floating contract：

- Dockview workspace root 使用 `position: fixed; inset: 0`，属于网页/VS Code tab 上方的独立 UI 图层，不随网页 document scroll 移动；
- 工具栏默认位于 visual viewport 底部居中，并避开 `safe-area-inset-bottom`；
- 浮动位置使用 viewport CSS pixels，不使用随文档滚动的 page coordinates；
- 拖动结束时 clamp 到 visual viewport，不能把标题栏或唯一恢复入口拖出屏幕；
- 贴边吸附要有 hysteresis：进入阈值后吸附，离开更大的阈值后才释放，避免边缘抖动；
- layer panel 可以默认靠右或跟随当前编辑区域，但所有 Dockview panel 都位于同一个固定 UI 层；
- 文档锚定的图层/笔迹渲染根可以随网页滚动，但必须位于 Dockview UI 的 z-index band 之下；
- 图层业务顺序不直接映射为可突破 UI 层级的 CSS `z-index`，Dockview panel、tab、menu、tooltip 始终拥有更高层级；
- z-order 由 focus/activation 更新，但 panel body 的点击不能让网页内容永久失去控制权；
- 移动端优先使用 bottom sheet、全屏 sheet 或窄 rail，而不是把桌面浮窗缩到无法操作；
- 软键盘、旋转、浏览器缩放和 webview 尺寸变化后重新 clamp，并保留用户的相对位置意图。

### Contextual panels

面板内容可以随 active tool、selection、layer 或 document 改变，但布局状态和业务状态要分离：

- tool settings 面板只显示当前工具有效的设置；没有有效工具时显示说明，而不是空白；
- layer panel 的 active layer 改变不应重置面板宽度、tab 和滚动位置；
- 被锁定、隐藏或不适用的控制项要解释原因，并保持可访问的 disabled 状态；
- 面板在异步加载上下文时保持标题和布局稳定，避免整体闪烁；
- 关闭或切换文档前，如果面板有未提交的设置，必须有明确的提交/撤销语义。

## gpen 的架构建议

### 业务模型不依赖布局引擎

面板系统应把“面板是什么”和“面板放在哪里”分开。可以先用下面的概念模型，不必立即固定为最终 TypeScript 类型：

```ts
type PanelDefinition = {
  id: string;
  label: string;
  icon?: string;
  canClose: boolean;
  canFloat: boolean;
  canDock: boolean;
  minSize: number;
  maxSize?: number;
};

type PanelInstance = {
  instanceId: string;
  definitionId: string;
  collapsed: boolean;
  pinned: boolean;
  open: boolean;
  context?: string;
};

type LayoutNode =
  | { kind: "panel"; instanceId: string }
  | { kind: "stack"; active: string; children: LayoutNode[] }
  | {
      kind: "split";
      axis: "horizontal" | "vertical";
      ratio: number;
      children: LayoutNode[];
    }
  | {
      kind: "float";
      instanceId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
```

布局引擎只负责把 `LayoutNode` 渲染成 dock/split/float；工具、图层和 stroke 数据不应该依赖某个第三方 panel instance。

### 图层模型与 `gpen-protocol`

图层数据以 [`gpen.tsp`](../../gpen-protocol/protocol/v1/gpen.tsp) 的 `Gpen` 模型为协议来源，不在面板实现中重新发明一套平面的 `z-index` 图层数组。当前需要对齐的字段分为以下几组：

- **树结构**：`Gpen.nodes`、`Gpen.layers`、`Gpen.groups`、`active_node_index`；节点使用 `name`、`type`、`item_index`、`parent_index`、`color` 和 `flags`，组使用 `child_range` 和 `color_tag`；
- **节点状态**：`LayerFlags.hidden`、`locked`、`selected`、`muted`、`use_lights`、`hide_onion_skin`、`expanded`、`hide_masks`、`disable_masks_in_viewlayer` 和 `ignore_locked_materials`；
- **图层内容状态**：`frames`、`masks`、`blend_mode`、`opacity`、`parent`、`transform`、`parent_inverse` 和 `view_layer_name`；
- **文档级状态**：`drawings`、`materials`、`onion_skinning_settings` 和 `Gpen.flags`，按协议模型处理，不塞进 Dockview panel state。

图层树的子节点顺序和父子关系决定绘制顺序；协议本身没有 CSS `z-index` 字段。渲染器应把树顺序转换为文档锚定渲染根内的顺序，并把所有图层渲染限制在低于 Dockview UI 的 stacking context 中。图层即使处于最上方，也不能覆盖 Dockview 的面板、tab、菜单或 tooltip。

建议把 DOM 层级固定为：

```text
网页/VS Code tab 的文档内容
        ↓
gpen document-anchored drawing/layer renderer（可随网页滚动）
        ↓
Dockview fixed workspace root（不随网页滚动，始终高于图层 renderer）
```

这里的箭头表示视觉层级，不表示必须把这些节点互相嵌套。实际实现应使用明确的 host、stacking context 和 z-index band，禁止任意图层字段直接修改 Dockview 的层级。

图层交互状态机需要区分协议持久化字段和临时 UI 字段：

| 操作                   | 协议字段                                      | 临时 UI 字段                                        |
| ---------------------- | --------------------------------------------- | --------------------------------------------------- |
| 选择图层/组            | `active_node_index`、`flags.selected`         | pointer/keyboard 来源、焦点目标                     |
| 显示、锁定、静音、展开 | 对应 `LayerFlags`                             | pending toggle、错误提示                            |
| 重排或移入组           | `parent_index`、`child_range`、节点顺序       | dragged node、drop parent、preview position         |
| 调整图层属性           | `opacity`、`blend_mode`、`masks`、`transform` | draft value、commit/cancel 状态                     |
| 绘制顺序               | 树遍历和组内顺序                              | 当前 render snapshot，不新增 CSS `z-index` 协议字段 |

图层面板的布局状态（宽度、collapsed、tab、滚动位置）继续由 Dockview/workspace 持久化；图层内容状态和 active node 由 gpen document model 持久化，两者不能混为一个对象。

### 状态机

最少需要明确这些状态和转换：

```text
idle
 ├─ header pointerdown → dragging
 ├─ splitter pointerdown → resizing
 ├─ collapse button → collapsed/expanded
 └─ panel menu → menu-open

dragging
 ├─ over valid target → docking-preview
 ├─ move outside → floating
 ├─ pointerup → commit-layout
 ├─ Escape / RMB / pointercancel → cancel → idle
 └─ window blur → cancel or commit-safe-position
```

画布绘制的 pointer 状态机不能和面板拖动共用一个全局布尔值。只有命中 panel chrome 时才进入面板状态；panel 以外的 overlay 必须让网页或画布继续收到事件。

### 事件契约

所有布局事件都要携带 `origin: 'user' | 'api' | 'restore'`，建议至少包括：

- `panel-toggle`：collapsed/expanded；
- `panel-focus`：active panel/stack；
- `panel-drag-start`、`panel-dock-preview`、`panel-dock-commit`；
- `panel-resize-start`、`panel-resize`、`panel-resize-end`；
- `panel-close`、`panel-hide`、`panel-pin`；
- `layout-change`：可序列化的布局快照和 schema version。

当前 `<gpen-panel>` 的 `collapsed` property/attribute 和 `gpen-panel-toggle` 事件保持不变；未来的 dock manager 应包裹它，而不是让它知道 dock tree。

### 持久化范围

建议把布局拆成三层：

1. **用户偏好**：工具栏位置、默认 rail、主题、默认面板宽度；
2. **workspace**：panel tree、tab 顺序、split ratio、哪些面板打开；
3. **文档状态**：当前 layer、selection、文档专属 panel/context。

存储内容必须有 `schemaVersion` 和迁移函数。恢复失败时使用安全默认布局，并保留原始快照供诊断；不能因为一个坏 panel id 让整个编辑器不可用。布局写入应 debounce，pointermove 期间只更新内存和视觉位置，在 pointerup 后提交。

## 可访问性和响应式要求

- 工具栏使用 `role="toolbar"`，工具按钮使用 `aria-pressed`；面板使用 `region`/标题，收起按钮使用 `aria-expanded` 和 `aria-controls`；
- splitter 使用 `role="separator"`、`aria-orientation`，若支持键盘调整则提供 `aria-valuenow/min/max`；
- tabs 使用 `tablist`、`tab`、`tabpanel` 关系，支持方向键、Home/End、关闭和焦点返回；
- 所有 hover 操作都有 keyboard 等价操作；焦点环不能被 Shadow DOM 或 overflow 裁掉；
- icon-only 状态必须有 accessible name 和 tooltip，不能只依赖颜色或图形；
- 支持 `prefers-reduced-motion`、RTL、窄屏和高对比度；
- 交互命中区先按触摸设备设计，不能因为面板变成 rail 就小于可操作尺寸；
- 面板内滚动、页面滚动和画布缩放必须互不误触；
- 浮动面板打开后焦点进入合理位置，关闭/收起后焦点返回触发它的按钮。

## 分阶段实施

### Phase 0：当前基础设施

- 保留 `<gpen-panel>` 作为可收起面板容器；
- 补齐 `gpen-panel` 的 header menu、min/max size、focus return 和 panel state tests；
- 不保存未经版本化的布局 JSON；为 Dockview workspace 和 `gpen-protocol` 图层数据分别准备版本化 adapter；
- 建立网页内容、document-anchored renderer 和 Dockview fixed workspace 的 stacking/z-index band 约束。

### Phase 1：浮动工具栏

- 先实现自有 `ToolbarModel` 和五个工具的互斥状态；
- 以 `position: fixed` 的 Dockview workspace root 承载 gpen UI；面板 header drag、pointer capture、snap 和 bounds 使用 Dockview 内置能力；
- `@floating-ui/dom` 只用于 tooltip、color picker、popover 等锚定控件；
- 画布/网页事件透传、pen/touch/mouse 仲裁、visual viewport 和 safe area 由 gpen 自己测试；
- 记录 `position`, `anchor`, `collapsed`, `schemaVersion`，支持 reset。
- 通过 Dockview 配置启用内置 dropzone、docking preview、panel docking 和 tab 重排；本阶段不实现第二套自有 dropzone。

### Phase 2：Dockview 工作区接入

Dockview 已经提供内部 dropzone、docking、split、tab 重排和 preview。本阶段只验证配置和 adapter 是否能把它接入 gpen 的 panel model，并确保固定 workspace 不随网页滚动。

分别用 Dockview vanilla 和 Lumino 做最小 demo，比较：

- Svelte slot/custom element 生命周期；
- Shadow DOM 和主题覆盖；
- tabs/split/floating/popout 的序列化与恢复；
- touch resize、键盘 docking、ARIA 和 focus return；
- iframe、VS Code webview、userscript 和多窗口限制；
- bundle size、license、升级频率和调试成本。

只有 POC 通过这些条件，才把布局引擎加入正式依赖；如果不兼容，则暂缓工作区接入，不在 gpen 中重新实现 Dockview 已经提供的内部 DnD 能力。

### Phase 3：图层面板

- 先依据 `gpen-protocol` 实现 `nodes/layers/groups/active_node_index` 的最小图层模型，再实现单一右侧/浮动 layer panel；
- layer flags、frames、masks、blend mode、opacity、parent、transform 与 panel layout 分开持久化；
- 图层渲染顺序由协议图层树推导，渲染层级固定低于 Dockview workspace，不暴露可覆盖 Dockview 的 CSS `z-index`；
- 再加入 stack、pin、resize 和 responsive sheet；
- 增加空状态、锁定状态、上下文切换、撤销/重做和异常恢复测试；
- 最后再考虑跨窗口 popout，不把它作为浏览器端基础能力。

## 验收清单

- [ ] 面板可展开、收起、隐藏、固定、关闭，并且这些状态语义不同；
- [ ] Dockview 内部面板可以通过配置完成拖拽、停靠、分栏、加入 tab 和 preview，且 gpen 不重复实现这些能力；
- [ ] Dockview workspace 使用 fixed root，网页滚动时面板、tab、菜单和 tooltip 仍可见；
- [ ] 图层 renderer 随网页内容使用正确的 document/viewport 坐标，但不能覆盖 Dockview UI；
- [ ] 图层模型与 `gpen-protocol` 的 nodes/layers/groups/flags/active_node_index 字段对齐；
- [ ] 图层树顺序负责绘制顺序，不通过业务字段设置可越过 Dockview 的 CSS `z-index`；
- [ ] layout JSON 可版本化、迁移、恢复失败回退和 reset；
- [ ] pointer/keyboard/touch/pen 的事件边界有自动化测试；
- [ ] 画布滚动、缩放、iframe、webview、safe area 和软键盘不破坏面板；
- [ ] 触摸、键盘、RTL、reduced-motion、对比度和 screen reader 基本行为通过验收；
- [ ] panel body 不绑定 Dockview/Lumino 等布局引擎的业务 API；
- [ ] 至少有一套默认布局和一键恢复默认布局；
- [ ] 第三方库升级可以通过 adapter 和契约测试隔离。
