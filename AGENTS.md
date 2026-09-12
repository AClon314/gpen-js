# gpen-js 开发规范

## TypeScript / JavaScript

- class 成员默认公开，不写 `public` 关键字。
- 需要表达 `private` 时使用 `_` 前缀命名，例如 `_value`。

## Svelte 组件

- 可复用组件统一放在 `src/lib/components/`，使用 `#lib/components/...` 导入。
- 原生 Custom Element（web component）组件使用 `.web.svelte` 后缀，例如 `GpenButton.web.svelte`、`GpenPanel.web.svelte`，并在组件中使用 `<svelte:options customElement={{ tag: 'gpen-xxx' }}>`。
- 普通 Svelte 组件使用 `.svelte` 后缀，例如 `GpenOverlay.svelte`、`GpenWorkspace.svelte`，不暴露为 web component。
- `vite.config.ts` 已按 `.web.svelte` 后缀启用 custom element 编译；新增 web component 只需遵循该命名即可，不要改匹配规则。
- 仅单个路由使用的组件放在该路由目录（与 `+page.svelte` 同级），使用相对路径导入；跨路由复用的组件放在 `src/lib/components/`。

## 工程约定

- 使用 `bun` 管理依赖和运行脚本，不使用 npm/pnpm 替代项目脚本。
- `bun run dev` 启动 SvelteKit 开发服务器；应用为客户端渲染，`src/routes/+layout.ts` 设置了 `ssr = false`。
- `#lib` / `#lib/*` 是项目导入别名，定义在 `package.json` 的 `imports` 中。

### 校验与测试

- `bun run lint` 等价于 `bun run typecheck && oxlint && eslint`。
- `bun run typecheck` 执行 SvelteKit、Svelte 和 TypeScript 类型检查。
- `bun run format` 使用 `oxfmt` 格式化项目。
- 单元测试：`bun test tests/*.test.ts`。
- e2e 测试：`bun run test:e2e`。

### 提交与错误处理

- 提交消息遵循 Conventional Commits；项目使用 `commitlint`，并提供 `.husky/commit-msg` hook 入口。
- oxlint 自定义规则：`catch/must-return-or-throw` 为 error，`catch/no-bare-return` 为 warning。
- ESLint 的 type-aware 自定义规则 `catch/no-void-catch-return` 为 error。
- `catch` 内的裸 `return;` 必须有 `console.*` 诊断日志；确有必要时用 `// oxlint-disable-next-line` 明确豁免。

## CSS 长度单位

- 横向尺寸和间距使用 `ch`；纵向尺寸和间距，尤其 `height` / 行高相关尺寸，使用 `lh`。适用于对应方向的 width、padding、margin、gap 等布局长度。
- 这样可以对齐终端字符格（约 `1ch` 宽、`1lh` 高），为后期 TUI 移植铺路。
- 字号、边框宽度、阴影等非布局长度不适用这条规则。
- 存量 `px` / `rem` 不做机械替换：`ch` / `lh` 与 `px` 不是 1:1，实际值取决于字号和行高；按具体设计逐项换算，渐进迁移。
