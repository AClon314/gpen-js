# gpen-js 开发规范

> 常驻上下文：只放「无法从代码推断、删掉 agent 就会做错」的全局规则。
> 模块地图 / 依赖边 / 健康度基线见 [`ARCHITECTURE.md`](ARCHITECTURE.md)；术语缩写见 [`GLOSSARY.md`](GLOSSARY.md)；
> 各领域细节见对应目录的 `README*.md`（就近代码旁）。

## TypeScript / JavaScript

- class 成员默认公开，不写 `public` 关键字；需要表达 `private` 时用 `_` 前缀，例如 `_value`。
- Svelte 5 runes（`$state` / `$props` / `$derived` / `$effect` / `$bindable`）；模板事件用 `onclick`，不用 `on:click`。

## Svelte 组件

- 可复用组件放 `src/lib/components/`，用 `#lib/components/...` 导入，按领域分子目录（`areas/` / `widgets/` / `workspace/` / `contextMenu/` 等）。
- 仅单个路由使用的组件与该路由的 `+page.svelte` 同级、相对路径导入；跨路由复用的才进 `src/lib/components/`。
- 原生 Custom Element（web component）用 `.web.svelte` 后缀 + `<svelte:options customElement={{ tag: 'gpen-xxx' }}>`；`vite.config.ts` 按该后缀启用编译，**不要改匹配规则**。普通组件用 `.svelte`，不暴露为 web component。

## lib 目录与导入

- 跨路由复用的代码放 `src/lib/`；对外 API 从 `src/lib/index.ts` 统一导出，消费方用 `#lib` / `#lib/*`（别名见 `package.json#imports`）。
- 按领域分目录；`bindings/` 只放 target/runtime 适配（storage / upDownloader / shell），领域模型不要混进去。模块地图见 `ARCHITECTURE.md` §1。
- 逻辑与框架解耦：纯逻辑导出成普通函数（便于 `bun test` 单测，如 `boundsFor` / `clampToBounds` / `reconcileBoundsPosition`），DOM / Svelte 相关部分放 action 或组件。

## 原生优先（MDN / 浏览器行为）

- 默认依赖原生行为：优先原生元素/属性、原生约束校验（`setCustomValidity` / `:invalid` / `required`）与浏览器默认交互（剪切复制粘贴、右键菜单、selection），再考虑自研。
- `<input type>` 一律渲染原生元素，只有 `number` 自研（`InputNumber` 要「按光标位权步进」，原生 `<input type="number">` 没有 `selectionStart` / `setSelectionRange`）。`color` 是例外中的例外：**既不自研也不用原生 `<input type="color">`**，用 Spectrum Web Components 取色器；多行文本 `CodeEditor` 用 CodeMirror 6 替掉 `<textarea>`。
- 每处自研例外都要记录「缺口 + 自研代价」，落在对应目录 README：`src/lib/components/widgets/inputs/README.md`、`README-code-editor.md`、`src/lib/components/widgets/colors/README.md`。

## 样式与 token

- 组件用 `var(--gpen-*)` 消费 token；需要局部变体时**覆盖变量本身**，不要新增「传具体值」的 props。
- 组件尺寸由调用方用**内联 `style`** 覆盖（如 `<Input style="width: 12ch" />`）。不要用 Tailwind 工具类：utility 在 `@layer utilities`，而 Svelte scoped 规则**无层级**（无层级永远压过带层级），特异性也更高。
- 全局设计 token 定义在 `src/lib/themes/day-night.css`：随主题变化的 token 一次 `light-dark(浅色, 深色)`，由 `color-scheme` 取支；手动主题只由 JS 在根元素写 `data-gpen-theme`。**不要**加 `@media (prefers-color-scheme: dark)` 覆盖块（它无法被属性覆盖，会顶掉手动 light）。`src/app.css` 是 Tailwind 入口并 `@import` 该文件。机制细节见 `day-night.css` 头注释与 `src/lib/components/README-preferences.md`。

## 运行时与实例约定

- `GpenOverlay` 只在根 layout（`src/routes/+layout.svelte`）里 `mount` **一次**；页面组件不要再渲染它，否则会出现多个实例。
- overlay 根节点固定标记：`class="gpen-overlay"`、`data-version={__GPEN_VERSION__}`、`data-instance={createInstanceId()}`（运行时唯一，用于自指当前实例）。
- 构建期常量经 `vite.config.ts` / `vite.embed.config.ts` 的 `define` 注入，并在 `src/app.d.ts` 声明（如 `__GPEN_VERSION__`）。
- 透明视口要能与宿主网页交互：`.overlay` / dockview 容器用 `pointer-events: none`，交互 chrome（tab、按钮、axis gizmo、缩放条）再 `auto`；`user-select: none` 只加在 gpen 自己的 chrome 上，不要加在宿主页元素上（`user-select` 按 DOM 树继承）。

## 工程约定

- 使用 `bun` 管理依赖和运行脚本，不使用 npm/pnpm 替代项目脚本。
- 应用为客户端渲染，`src/routes/+layout.ts` 设置了 `ssr = false`。
- 浏览器行为验证用 `agent-browser`；交互（拖拽 / 触摸 / 缩放）改动必须真机或模拟实测。

### 文件体量

- **单个文件不超过 1000 行**。超了就要动结构：先把职责拆成模块（优先拆「纯逻辑」出去，让它可 `bun test`），而不是继续往下堆。
- 拆之前先做**消融实验**：确认那段代码真的是复杂度来源（去掉它行为是否变、测试是否仍能守住），别为了行数做无收益的搬家。
- **不要和功能改动混在一起做**：先把功能加完、测试跑绿，再单独一轮做模块化重构。一次一轮、每轮跑绿再合。历史拆分案例见 `ARCHITECTURE.md` §9。

### 校验与测试

- `bun run lint` = `bun run typecheck` + `oxlint` + `eslint` + `bun run lint:exports`（order-exports 导出顺序检查）。
- `bun run typecheck` 执行 SvelteKit、Svelte 和 TypeScript 类型检查。
- `bun run format` 使用 `oxfmt` 格式化项目（`.svelte` 不在其覆盖范围内）。
- 单元测试：`bun test tests/*.test.ts`；覆盖率 `bun run test:coverage`。
- e2e 测试：`bun run test:e2e`。
- 健康度门禁：`bun run health:gate`（`large_method` 等命中即 fail，`-- --module <path>` 限定范围）。

### 提交与错误处理

- 提交消息遵循 Conventional Commits；项目使用 `commitlint`，并提供 `.husky/commit-msg` hook 入口。
- `catch` 内的裸 `return;` 必须有 `console.*` 诊断日志；确有必要时用 `// oxlint-disable-next-line` 明确豁免。

## CSS 长度单位

- 横向尺寸和间距使用 `ch`；纵向尺寸和间距，尤其 `height` / 行高相关尺寸，使用 `lh`。适用于对应方向的 width、padding、margin、gap 等布局长度。
- 这样可以对齐终端字符格（约 `1ch` 宽、`1lh` 高），为后期 TUI 移植铺路。
- 字号、边框宽度、圆角、阴影等非布局长度不适用这条规则。
- 存量 `px` / `rem` 不做机械替换：`ch` / `lh` 与 `px` 不是 1:1，实际值取决于字号和行高；按具体设计逐项换算，渐进迁移。

## 文档

- 一处一主题，文档放**代码旁**：领域文档用对应目录的 `README*.md`（如 `src/lib/bindings/storage/README.md`、`src/lib/protocol/README.md`）；跨领域术语表在根 `GLOSSARY.md`；架构与依赖基线在根 `ARCHITECTURE.md`。
- 存储 broker 的安全与信任模型见 [`src/lib/bindings/storage/README-trust-model.md`](src/lib/bindings/storage/README-trust-model.md)。
