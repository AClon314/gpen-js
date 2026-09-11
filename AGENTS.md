## TypeScript/JavaScript 命名约定

- class 成员默认公开，不写 `public` 关键字。
- 如果要表达 `private`，使用 `_` 前缀命名（例如 `private value` 改为 `_value`）

## Svelte 组件目录约定

- 可复用 Svelte 组件统一放 `src/lib/components/`，用 `#lib/components/...` 导入（`#lib` 别名见 `package.json`）。
- **渲染为原生 Custom Element（web component）的组件用 `.web.svelte` 后缀**，如
  `GpenButton.web.svelte`、`GpenPanel.web.svelte`。这些文件用 `<svelte:options customElement={{ tag: 'gpen-xxx' }}>`。
- **普通 Svelte 组件（不暴露为 web component）用 `.svelte` 后缀**，如 `GpenOverlay.svelte`、`GpenWorkspace.svelte`。
- `vite.config.ts` 的 `compilerOptions.customElement` 按 `.web.svelte` 后缀匹配；新增 web component 时只要用 `.web.svelte` 命名即可自动启用 custom element 编译，无需改匹配规则。
- 仅单个路由使用的组件可放该路由目录（`+page.svelte` 同级），局部导入用相对路径；跨路由复用的放 `src/lib/components/`。
