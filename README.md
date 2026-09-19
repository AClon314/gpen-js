# gpen-js

把 Blender Grease Pencil 的数据结构搬到 Web，目标是在浏览器和 VS Code 扩展里提供接近 Saber 的笔记 / 绘画体验。应用采用客户端渲染，不做 SSR。

## 本地运行

使用 Bun 安装依赖并启动开发服务器：

```sh
bun install
bun run dev
```

打开终端显示的地址即可。首页 `/` 就是 gpen 入口：右下角有一个可拖动、吸附屏幕边缘的**悬浮球**，点它展开 Blender 风格工作区（dockview 面板 + 中央透明视口），`Esc` 或右上角 `×` 关闭。悬浮球位置会记住。

## 页面与 demo

| 路由 | 用途 |
| --- | --- |
| `/` | gpen 入口：网页 + 悬浮球进入 Blender 风格工作区（透明视口可穿透与网页交互） |
| `/demo/code` | CodeMirror demo：`numberStepper` / `numberScrubber` 数值插件 + `CodeEditor` 组件（表单关联、只读 / 禁用、注入扩展） |
| `/demo/cross-tab-bus` | 使用同源 `BroadcastChannel` 的跨标签页消息 demo；打开两个同源标签页体验 |
| `/demo/rotate` | 画布视图旋转与双指手势 demo |
| `/demo/storage` | KV / Blob 存储 demo；普通网页中使用 IndexedDB |
| `/demo/widgets` | UI widgets demo（Blender 风格数值 `Input`：点按编辑 / 拖拽 / 右键菜单 / 单位换算 / 悬浮 Ctrl+C·V / 内联宽度） |
| `/demo/zoom` | 浏览器缩放、visual viewport 与反向 `zoom` demo |
| `/storage-broker` | 跨 origin 的 OPFS storage broker；必须作为 iframe 运行，并传入 `parentOrigin`、`channel` 查询参数（`timeout` 可选） |

## 相关文档

- [Glossary](docs/glossary.md)：术语 / 缩写速查（postMessage、OPFS、JWT、DPoP…）
- [Safety](docs/todo-safe.md)：storage-broker 的安全设计与信任模型（TODO）
- [Storage](docs/storage.md)：storage API 与 storage broker 契约
- [Web Components](docs/web-components.md)：Custom Element 评估与 `gpen-panel` 契约
- [Panel](docs/panel.md)：面板库评估、Blender / Adobe UX 要点与面板系统设计
- [FlatBuffers](docs/flatbuffers.md)：协议与生成链路
- [Dropzone](docs/dropzone.md)：拖放相关说明
- [Input](docs/input.md)：输入控件：`Input` 分发壳与 `InputNumber` / `InputSlider`（步进、校验、单位、内联宽度、悬浮剪贴板；含原生优先的例外与自研代价）
- [CodeMirror](docs/codemirror.md)：CodeMirror 6 数值插件（`numberStepper` / `numberScrubber`）与接线范式
- [Code editor](docs/code-editor.md)：`CodeEditor` 组件（CM 文档 ⇄ 表单值同步、镜像 textarea、无障碍、缺口与代价）
- [Units](docs/units.md)：单位模型（注册表 / 量纲表、换算与别名、`bindUnit`）
- [Build targets](docs/build-targets.md)：userscript / 浏览器扩展 / npm / VS Code 多目标构建与自动化测试可行性方案

## 开发入口

开发规范、目录约定、校验、测试和 CSS 约定见 [AGENTS.md](AGENTS.md)。
