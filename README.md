# gpen-js

把 Blender Grease Pencil 的数据结构搬到 Web，目标是在浏览器和 VS Code 扩展里提供接近 Saber 的笔记 / 绘画体验。应用采用客户端渲染，不做 SSR。

## 本地运行

使用 Bun 安装依赖并启动开发服务器：

```sh
bun install
bun run dev
```

打开终端显示的地址即可。首页 `/` 就是 gpen 入口：右下角有一个可拖动、吸附屏幕边缘的**悬浮球**，点它展开 Blender 风格工作区（dockview 面板 + 中央透明视口），`Esc` 或右上角 `×` 关闭。悬浮球位置会记住。

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `bun run dev` | 启动 SvelteKit 开发服务器（客户端渲染） |
| `bun run test` | 单元测试（`tests/*.test.ts`） |
| `bun run test:coverage` | 单测 + lcov 覆盖率（过滤后落 `coverage/`） |
| `bun run test:e2e` | Playwright e2e |
| `bun run lint` | `typecheck` + `oxlint` + `eslint` + `lint:exports`（导出顺序） |
| `bun run health:gate` | oxlint 健康度门禁（`-- --module <path>` 限定范围） |
| `bun run build` | 构建 SvelteKit 静态站点到 `build/` |
| `bun run build:embed` | 构建框架无关的 embed bundle 到 `dist/embed/` |
| `bun run test:embed` | embed bundle 的 Playwright 测试 |

## 构建目标（targets）

核心是框架无关的 **embed bundle**：`bun run build:embed` 产出 `dist/embed/gpen-embed.js`（ES）+ `gpen-embed.iife.js`（IIFE），挂进 ShadowRoot、样式不污染宿主页；userscript / 浏览器扩展 / npm / VS Code 各壳是同一份产物的薄封装，壳仓库由 `gpen/scripts/targets.mjs` 跨仓库编排 build/test。

npm 消费走 `package.json#exports`：`gpen-js/storage`、`gpen-js/upDownloader`、`gpen-js/storage/vscode`、`gpen-js/embed`。详见 [`src/embed/README.md`](src/embed/README.md) 与 `TODO.md`「多目标构建」一节。

## 页面与 demo

| 路由 | 用途 |
| --- | --- |
| `/` | gpen 入口：网页 + 悬浮球进入 Blender 风格工作区（透明视口可穿透与网页交互） |
| `/demo/colors` | 颜色控件 demo（Spectrum Web Components：面积图 / 色相条 / 十六进制字段） |
| `/demo/code` | CodeMirror demo：`numberStepper` / `numberScrubber` 数值插件 + `CodeEditor` 组件（表单关联、只读 / 禁用、注入扩展） |
| `/demo/cross-tab-bus` | 使用同源 `BroadcastChannel` 的跨标签页消息 demo；打开两个同源标签页体验 |
| `/demo/menu` | 菜单栏 / 右键菜单 / 命令注册表 demo |
| `/demo/rotate` | 画布视图旋转与双指手势 demo |
| `/demo/storage` | KV / Blob 存储 demo；普通网页中使用 IndexedDB |
| `/demo/widgets` | UI widgets demo（Blender 风格数值 `Input`：点按编辑 / 拖拽 / 右键菜单 / 单位换算 / 悬浮 Ctrl+C·V / 内联宽度） |
| `/demo/zoom` | 浏览器缩放、visual viewport 与反向 `zoom` demo |
| `/storage-broker` | 跨 origin 的 OPFS storage broker；必须作为 iframe 运行，并传入 `parentOrigin`、`channel` 查询参数（`timeout` 可选） |

## 相关文档

文档已就地化到代码旁，下面是索引。

- [Architecture](ARCHITECTURE.md)：模块地图、跨目录依赖边、循环、热点 / 健康度基线
- [Glossary](GLOSSARY.md)：术语 / 缩写速查（postMessage、OPFS、JWT、DPoP…）
- [AGENTS.md](AGENTS.md)：开发规范、目录约定、校验 / 测试、CSS 长度约定

### 领域文档

| 主题 | 文档 |
| --- | --- |
| 存储 API 与 broker 契约 | [`src/lib/bindings/storage/README.md`](src/lib/bindings/storage/README.md) |
| storage-broker 安全与信任模型（TODO） | [`src/lib/bindings/storage/README-trust-model.md`](src/lib/bindings/storage/README-trust-model.md) |
| 协议与 FlatBuffers 生成链 | [`src/lib/protocol/README.md`](src/lib/protocol/README.md) |
| 输入控件（`Input` / `InputNumber` / `InputSlider`） | [`src/lib/components/widgets/inputs/README.md`](src/lib/components/widgets/inputs/README.md) |
| `CodeEditor` 组件 | [`src/lib/components/widgets/inputs/README-code-editor.md`](src/lib/components/widgets/inputs/README-code-editor.md) |
| CodeMirror 数值插件 | [`src/lib/components/widgets/inputs/README-codemirror.md`](src/lib/components/widgets/inputs/README-codemirror.md) |
| 颜色控件（Spectrum 取色器） | [`src/lib/components/widgets/colors/README.md`](src/lib/components/widgets/colors/README.md) |
| 单位模型（注册表 / 换算 / `bindUnit`） | [`src/lib/inputs/README.md`](src/lib/inputs/README.md) |
| 面板库评估与面板系统设计 | [`src/lib/components/README-panel.md`](src/lib/components/README-panel.md) |
| 偏好 UI | [`src/lib/components/README-preferences.md`](src/lib/components/README-preferences.md) |
| 视图导航小地图 | [`src/lib/components/README-minimap.md`](src/lib/components/README-minimap.md) |
| CodeArea（可编辑文本外壳） | [`src/lib/components/codeArea/README.md`](src/lib/components/codeArea/README.md) |
| 图层树（Outliner）选型与接口 | [`src/lib/layers/tree/README.md`](src/lib/layers/tree/README.md) |
| 图层视图（相机 / 旋转）与描边 | [`src/lib/layers/README.md`](src/lib/layers/README.md) / [`README-stroke.md`](src/lib/layers/README-stroke.md) |
| 主题与设计 token | [`src/lib/themes/README.md`](src/lib/themes/README.md) |
| 命令 / 菜单 / 快捷键 | [`src/lib/commands/README.md`](src/lib/commands/README.md) |
| 统一拖放目标检测 | [`src/lib/gestures/README.md`](src/lib/gestures/README.md) |
| Web Components 评估与 `gpen-panel` 契约 | [`src/lib/components/README-web-components.md`](src/lib/components/README-web-components.md) |
| 多目标构建（userscript / 扩展 / npm / VS Code） | [`src/embed/README.md`](src/embed/README.md) |
