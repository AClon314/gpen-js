# gpen-js 开发规范

## TypeScript / JavaScript

- class 成员默认公开，不写 `public` 关键字。
- 需要表达 `private` 时使用 `_` 前缀命名，例如 `_value`。
- Svelte 5 runes（`$state` / `$props` / `$derived` / `$effect` / `$bindable`）；模板事件用 `onclick`，不用 `on:click`。

## Svelte 组件

- 可复用组件统一放在 `src/lib/components/`，使用 `#lib/components/...` 导入；按领域分子目录（`areas/` 工作区面板、`widgets/` 表单控件、`contextMenu/` 等）。
- 原生 Custom Element（web component）组件使用 `.web.svelte` 后缀，并在组件中使用 `<svelte:options customElement={{ tag: 'gpen-xxx' }}>`；`vite.config.ts` 按该后缀启用编译，不要改匹配规则。
- 普通 Svelte 组件使用 `.svelte` 后缀，不暴露为 web component。
- 仅单个路由使用的组件放在该路由目录（与 `+page.svelte` 同级），相对路径导入；跨路由复用的放 `src/lib/components/`。

## lib 目录与导入

- 跨路由复用的代码放 `src/lib/`，从 `src/lib/index.ts` 统一导出；消费方用 `#lib` / `#lib/*`（别名见 `package.json` 的 `imports`）。
- 按领域分目录：`bindings/`（只放 target/runtime 适配：storage / upDownloader / shell）、`protocol/`（gpen-protocol 编解码）、`layers/`（图层领域模型）、`crossTabBus/`（消息层）、`gestures/`（交互手势，如 `draggable` action）、`components/`（Svelte 组件）；单文件工具直接放 `src/lib/`（`error.ts`、`instanceId.ts`）。
- 逻辑与框架解耦：纯逻辑导出成普通函数（便于 `bun test` 单测，如 `boundsFor` / `clampToBounds` / `reconcileBoundsPosition`），DOM / Svelte 相关部分放 action 或组件。

## 样式与 token

- 全局设计 token 定义在 `src/app.css` 的 `:root`（`--gpen-*`）；Tailwind 入口（`@import "tailwindcss"`）也在该文件，由 `+layout.svelte` 引入。
- 组件用 `var(--gpen-*)` 消费；需要局部变体时**覆盖变量本身**，不要新增「传具体值」的 props。
- 长度单位见下「CSS 长度单位」。

## 运行时与实例约定

- `GpenOverlay` 只在根 layout（`src/routes/+layout.svelte`）里 `mount(GpenOverlay, { target: document.body })` 挂**一次**；页面组件不要再渲染它，否则会出现多个实例（body 直属也让它 `position: absolute` 以 ICB 为包含块）。
- overlay 根节点固定标记：`class="gpen-overlay"`、`data-version={__GPEN_VERSION__}`（构建期从 `package.json` 注入）、`data-instance={createInstanceId()}`（运行时唯一，用于自指当前实例）。
- 构建期常量经 `vite.config.ts` 的 `define` 注入，并在 `src/gpen-env.d.ts` 声明（如 `__GPEN_VERSION__`）。
- 透明视口要能与宿主网页交互：`.overlay` / dockview 容器用 `pointer-events: none`，交互 chrome（tab、按钮、axis gizmo、缩放条）再 `auto`；`user-select: none` 只加在 gpen 自己的 chrome 上，不要加在宿主页元素上（`user-select` 按 DOM 树继承，overlay 与宿主页不同子树）。

## 工程约定

- 使用 `bun` 管理依赖和运行脚本，不使用 npm/pnpm 替代项目脚本。
- `bun run dev` 启动 SvelteKit 开发服务器；应用为客户端渲染，`src/routes/+layout.ts` 设置了 `ssr = false`。
- 浏览器行为验证用 `agent-browser`；交互（拖拽 / 触摸 / 缩放）改动必须真机或模拟实测。

### 校验与测试

- `bun run lint` 等价于 `bun run typecheck && oxlint && eslint`。
- `bun run typecheck` 执行 SvelteKit、Svelte 和 TypeScript 类型检查。
- `bun run format` 使用 `oxfmt` 格式化项目（`.svelte` 不在其覆盖范围内）。
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
- 字号、边框宽度、圆角、阴影等非布局长度不适用这条规则。
- 存量 `px` / `rem` 不做机械替换：`ch` / `lh` 与 `px` 不是 1:1，实际值取决于字号和行高；按具体设计逐项换算，渐进迁移。

## 文档

- 一处一主题放 `docs/*.md`（如 `storage.md`、`panel.md`、`flatbuffers.md`）。
- 缩写 / 术语查 [`docs/glossary.md`](docs/glossary.md)。
- 存储 broker 的安全与信任模型见 [`docs/todo-safe.md`](docs/todo-safe.md)。
