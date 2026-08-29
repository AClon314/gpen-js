# gpen-js

把 Blender Grease Pencil 的数据结构搬到 Web，目标是在浏览器和 VS Code 扩展里提供接近 Saber 的笔记 / 绘画体验。

客户端渲染（`ssr = false`），国际化词条之后由 Paraglide 负责。

```sh
bun run dev
```

- `/` 主页面
- `/demo/web-component` Svelte 5 custom element demo（`<gpen-button>`）
- `/demo/panel` 可收缩面板 web component demo（`<gpen-panel>`）

UI 组件的 Spectrum Web Components 评估和 `<gpen-panel>` 的属性、事件契约见
[`docs/web-components.md`](docs/web-components.md)。

面板库评估、Blender/Adobe UX 要点和 gpen 面板系统设计见
[`docs/panel.md`](docs/panel.md)。
