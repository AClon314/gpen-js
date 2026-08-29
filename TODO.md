- [x] 搭建真实环境，CI测试自动化
  - [x] 参考gpen-browser-ext， 引入 ithub.com/wxt-dev/wxt 框架来简化 manifest v3 配置，以同时支持chrome/firefox/safari。难点：wxt似乎自带文件目录级别，与现有的gpen-js/src内的结构差异较大，如何引入 wxt? 以及是否有必要引入 wxt?
  - [ ] monkey 如何实现ci？
  - [x] vscode: code.visualstudio.com/raw/api/working-with-extensions/testing-extension.md
  - [x] website: 当前的bun或node.js是否包含 website.ts 所需的接口？如果不包含，是否有必要引入 jsdom 或类似更加真实且快速的测试库？

- [x] crossTabBus 消息传递层
- [x] storage 数据存储层，需重构
  - [x] OPFS 使用 crossTabBus 的 ArrayBuffer 跨 tab 传递数据；文件可统一存储在 domainX 的 OPFS 里，由 broker 分发
  - [x] 同步 storage -> kv
        `bindBlobToKv` / `createBlobKvSyncHooks` 将 Blob 的外部引用写入 KV，支持
        set/delete、URL schema、自动 `submit()` 和动态 proxy hooks；`blob.get.pathA.pathB`
        对应 `pathA/pathB`。
  - [x] `lib/bindings/selector/` 更名为 `upDownloader/`
    - [x] monkey/browser-ext/npm 使用 MDN File API；userscript 可选用 `GM_download`。
    - [x] VS Code 提供统一的本地、web、ssh 上传/下载 API。
    - [x] 本地 upload 优先尝试 VS Code API、shell `ln -s`/`mklink`，失败后记录到
          `.gpen/state.jsonc`；download 写入后通过 VS Code open-file API 打开。

- [ ] FlatBuffers 协议接入与跨运行时一致性（P0；方案和任务 ID 见 `docs/flatbuffers.md`）
  - [x] FBS-001 [gpen-protocol] 固定 TypeSpec → proto → `model.fbs` 生成链；处理
        `active_node_index`/`parent_index` 的 `0xffffffff` sentinel、`DrawingSlot` 两个 optional
        payload 的 validator 规则、矩阵长度和索引 bounds；不得直接修改 generated schema。
  - [x] FBS-002 [gpen-protocol] 使用 `flatc-wasm` 生成 TS accessor，确定
        `generated/flatbuffers` 输出、`.js` ESM import、object API 取舍、`./flatbuffers` export，
        并增加 generated diff 检查。
  - [x] FBS-003 [gpen-js + gpen-protocol] 固定并验证 compiler/runtime 版本；将
        `flatbuffers` 作为可解析的直接 runtime dependency，确认 `flatc-wasm` 不进入 gpen-js
        浏览器 bundle；同时记录 npm 包版本和实际 `FlatcRunner.version()`。
  - [x] FBS-004 [gpen-js] 新增纯 FlatBuffers codec/validator；生成的 `Gpen`/`GpenT` 只在
        adapter 内使用，domain model 与 accessor 解耦；覆盖 root、空文档、完整图层/笔迹、
        `Uint8Array` byte offset/生命周期和非法输入。
  - [x] FBS-005 [gpen-js] 将 codec 接入 Blob/KV：二进制保存到 Blob，KV 只保存版本化
        metadata 和引用；失败恢复与重开已实现；debounce/crossTabBus 转移策略留接入点实现，
        不改变现有 JSON KV API。
  - [x] FBS-006 [gpen-js + gpen-zig + gpen-protocol] 建立最小、完整、owned drawing、
        reference 和 invalid fixtures；用 `flatc-wasm` JSON、JS accessor、Zig accessor 互相
        验证，并同步当前已漂移的 Zig generated bindings。
  - [x] FBS-007 [gpen-js] 在 codec/fixture 完成后实现图层 protocol adapter；对齐
        `Gpen.nodes/layers/groups/active_node_index`、parent/child 顺序和 flags，协议图层顺序
        与 Dockview/UI stacking context 分离，不能用 CSS `z-index` 代替协议模型。
  - [x] FBS-008 [根仓库 CI] 串起 protocol generation、generated diff、JS typecheck/test/build、
        fixture conformance 和 bundle 检查；失败时报告 schema/compiler/runtime 版本。
  - [x] 按 `docs/flatbuffers.md` 执行批次：A=`FBS-001+003`，B=`FBS-002`，
        C=`FBS-004+006`，D=`FBS-005+007`，E=`FBS-008`；同批次仅在依赖满足后并行，前置
        任务改变 schema/默认值/union 语义时，后续 agents 必须重新读取文档和 fixtures。

- [x] web-component 评估是否要引入 opensource.adobe.com/spectrum-web-components/
  - [x] 当前暂不引入 Spectrum 作为基础依赖；先用原生控件和 CSS custom properties，保留未来
        只替换按钮、图标、表单控件的边界。理由与重新评估条件见 `docs/web-components.md`。
  - [x] 类似 Adobe 的面板伸缩系统：`<gpen-panel>` 支持 `collapsed` property/attribute、
        内容 slot、图标化恢复按钮、键盘操作、可访问名称和 `gpen-panel-toggle` 事件。
- [ ] 一个工具栏浮动面板，默认靠下居中，使用 Dockview 管理浮动与拖拽，包含5个操作按钮:
  - [ ] 面板库评估与 UX 设计见 `docs/panel.md`；Dockview 作为 gpen UI 的 workspace 容器，业务数据仍由 gpen 自己持有。
  - [ ] Dockview 宿主层：把网页视为 VS Code tab 中的主要内容区域，使用 `position: fixed` 的全屏图层附着在 viewport 上方；处理 visual viewport、safe-area inset、缩放、软键盘、iframe/webview 裁切和 z-index；网页滚动时 Dockview 面板、tab 和菜单保持可见，不改变网页文档流。
  - [ ] Dockview 内部拖拽：通过 `dndStrategy`、`dndEdges`、`disableDnd` 等配置启用内置的 dropzone、floating、docking、split、tab 重排和 docking preview；gpen 只接入公开事件并持久化 layout。
  - [ ] Dockview 与网页事件边界：定义 toolbar、canvas、layer panel 的层级和 `pointer-events` 规则；面板拖拽由 Dockview 负责，不再为 gpen UI 面板重复实现 Pointer Events 拖拽状态机；文档图层 renderer 的层级不得覆盖 Dockview。
  - [ ] 工具状态：五个按钮互斥选择，统一 active-tool 状态、`aria-pressed`、快捷键、禁用态、
        tooltip 和状态事件；工具栏本身可由 `gpen-panel` 收起为图标。
  - [ ] [鼠标] 交互模式，选中时，鼠标/笔/触摸事件 被网页接收（即释放控制权）
    - [ ] overlay 只保留工具栏命中区域，其余区域 `pointer-events` 透明；切换和失焦时释放
          pointer capture，不改变网页原有选择、链接、滚动和表单行为。
  - [ ] [画笔] 画笔工具，选中时，拦截鼠标/笔/触摸事件，绘制的stroke会“附着”在网页上，随网页滚动。
    - [ ] 坐标模型：统一 viewport/document/CSS pixel 坐标，考虑页面滚动、缩放、devicePixelRatio、
          iframe 和 canvas transform；stroke 保存 pressure、tilt、twist、pointerType、时间戳。
    - [ ] 渲染与数据解耦：stroke 有稳定 id，可增量渲染、撤销/重做、序列化到 storage，并能在
          页面滚动后通过坐标变换继续贴合页面。
    - [ ] 防误触: 笔 > 触摸 > 鼠标，笔在绘画时，忽略触摸与鼠标事件(后期提供mixin机制，通过重新组织代码，以覆盖此行为)
      - [ ] 以 `pointerId`/`pointerType` 做输入仲裁，抑制 pen/touch 产生的兼容 mouse 事件；定义
            多指触摸、pen hover、cancel、同时存在多个 pointer 时的状态机和测试矩阵。
    - [ ] 切换粗细与颜色
      - [ ] 明确颜色格式、最小/最大粗细、单位、压力映射与预设；控件支持键盘、对比度和窄屏布局。
  - [ ] [橡皮擦] 支持类似 blender, 按 一整条笔迹stroke/顶点point/溶解disolve, 见 docs.blender.org/manual/en/latest/grease_pencil/modes/draw/tools/erase.html (我们暂不实现disolve, 因为比较复杂，要同时控制顶点与颜色透明度)
    - [ ] 先确定 stroke/point 两种命中测试的容差、变换坐标、隐藏/锁定图层和 z-order 规则；
          每次擦除作为可撤销命令，`disolve` 明确保持 disabled 而不是静默失败。
  - [ ] [套索] 选择工具(暂时不做，只放个按钮)
    - [ ] 按钮初期使用 disabled/aria-disabled 和明确 tooltip，不抢占输入；后续定义闭合路径、
          相交/包含规则、多选、跨图层和选择状态事件。
  - [ ] [图层] 打开图层面板。
    - [ ] 依赖 `FBS-004`/`FBS-006` 的 protocol adapter 和 fixtures；以
          `../gpen-protocol/protocol/v1/gpen.tsp` 的 `Gpen.nodes/layers/groups/active_node_index`
          为来源，对齐 `LayerTreeNode`、`LayerFlags`、`Layer` 和 `LayerGroup` 字段，不直接在 UI
          import generated accessor 或重新发明平面图层数组。
    - [ ] 图层渲染使用独立的 document-anchored renderer，随网页内容滚动；其 z-index band 固定低于 Dockview fixed workspace，不能由图层业务状态覆盖 Dockview。
    - [ ] 实现 active node、hidden/locked/selected/muted/expanded、opacity、blend mode、masks、transform、parent 和树顺序状态机。
    - [ ] 定义新增/删除/重排/重父级/重命名/复制和持久化策略；协议字段、文档状态、Dockview layout 状态分开存储；空状态与不可编辑状态也要有 UI。

- [ ] 一个图层浮动面板
  - [ ] 复用 `gpen-panel` 的收起、恢复、slot 和事件契约；定义 toolbar 与 layer panel 的互斥/并存关系。
  - [ ] 使用 Dockview 内置能力处理拖拽、调整大小、贴边吸附、窄屏全屏化、Escape 关闭、焦点返回和 `prefers-reduced-motion`；gpen 负责配置和状态同步。
  - [ ] 明确面板布局状态按用户、文档还是宿主持久化，并通过 storage 版本迁移保证升级兼容。

- [ ] 网页 DOM 操作（非 gpen UI 面板）
  - [ ] 如果需要拖拽、缩放或旋转网页 DOM，使用 Moveable；Moveable 不参与 Dockview 面板的拖拽。
  - [ ] 明确网页 DOM 操作与 gpen overlay 的 pointer capture、z-index 和事件透传边界，避免两个拖动系统同时接管同一手势。
