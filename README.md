# gpen-js

把 Blender Grease Pencil 的数据结构搬到 Web，目标是在浏览器和 VS Code 扩展里提供接近 Saber 的笔记 / 绘画体验。应用采用客户端渲染，不做 SSR。

## 本地运行

使用 Bun 安装依赖并启动开发服务器：

```sh
bun install
bun run dev
```

开发服务器启动后，打开终端显示的地址。首页是 `/`；要直接打开 gpen 的 Blender 风格工作区，请访问 `/demo/blender`。

## 页面与 demo

| 路由 | 用途 |
| --- | --- |
| `/` | gpen 首页与入口 |
| `/demo/blender` | Blender 风格 gpen 工作区 / overlay |
| `/demo/cross-tab-bus` | 使用同源 `BroadcastChannel` 的跨标签页消息 demo；打开两个同源标签页体验 |
| `/demo/rotate` | 画布视图旋转与双指手势 demo |
| `/demo/storage` | KV / Blob 存储 demo；普通网页中使用 IndexedDB |
| `/demo/web-component` | Svelte 5 Custom Element（web component）demo |
| `/demo/widgets` | UI widgets demo |
| `/demo/zoom` | 浏览器缩放、visual viewport 与反向 `zoom` demo |
| `/storage-broker` | 跨 origin 的 OPFS storage broker；必须作为 iframe 运行，并传入 `parentOrigin`、`channel` 查询参数（`timeout` 可选） |

## 相关文档

- [Web Components](docs/web-components.md)：Custom Element 评估与 `gpen-panel` 契约
- [Panel](docs/panel.md)：面板库评估、Blender / Adobe UX 要点与面板系统设计
- [Storage](docs/storage.md)：storage API 与 storage broker 契约
- [FlatBuffers](docs/flatbuffers.md)：协议与生成链路
- [Dropzone](docs/dropzone.md)：拖放相关说明

## 开发入口

开发规范、目录约定、校验、测试和 CSS 约定见 [AGENTS.md](AGENTS.md)。
