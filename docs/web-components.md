# Web component UI 评估

## Spectrum Web Components

当前暂不把 `@spectrum-web-components/*` 作为 gpen 的基础依赖。项目目前只有一个按钮示例，
而未来的工具栏和图层面板需要自行处理浮动定位、拖拽、Pointer Events、画布事件转交和跨宿主
环境（浏览器、userscript、VS Code webview）。Spectrum 可以统一按钮、图标、提示框、颜色选择器
等控件的视觉和可访问性，但不会替代这些面板的几何与输入状态机。

暂缓引入的原因：

- 按组件拆包仍会增加扩展端的依赖与构建验证成本；
- Spectrum 的 Shadow DOM 样式边界会和宿主页面、VS Code webview 的主题适配叠加；
- 目前还没有足够的控件数量来抵消迁移成本。

组件内部使用 CSS custom properties（`--gpen-panel-*`）作为稳定边界。后续若需要 Spectrum，
可以只替换按钮、图标和表单控件，不改变面板的 DOM 投影、属性和事件契约。

## `gpen-panel`

`<gpen-panel>` 是当前面板基础设施的验证实现：

- `label`、`icon`、`collapsible`、`collapsed` 都可以作为 HTML 属性或 JS property 使用；
- 展开状态显示标题和内容 slot，收起状态只显示带 accessible name 的图标按钮；
- `collapsed` 会反映回 HTML 属性，切换时派发冒泡且跨 Shadow DOM 的
  `gpen-panel-toggle` 事件，detail 为 `{ collapsed, label }`；
- 使用原生 button，支持键盘操作、焦点可见样式和 reduced-motion；
- 面板状态暂不自动写入 storage。工具栏或图层宿主需要明确作用域后，再决定按页面、文档或用户
  偏好持久化。
