# gpen-js

把 Blender Grease Pencil 的数据结构搬到 Web，目标是在浏览器和 VS Code 扩展里提供接近 Saber 的笔记 / 绘画体验。

客户端渲染（`ssr = false`），国际化词条之后由 Paraglide 负责。

```sh
bun run dev
```

- `/` 主页面
- `/demo/web-component` Svelte 5 custom element demo（`<gpen-button>`）
