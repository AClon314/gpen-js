# rules/ —— 仓库级校验与静态分析

本目录放「机器可执行的仓库规则」：oxlint/ESLint 自定义规则，以及用来生成
**执行流（execution flows）**基线的静态分析器。

## 文件

| 路径 | 说明 |
| --- | --- |
| `catch-must-return-or-throw.mts` | oxlint 自定义规则（catch 块必须有 `return`/`throw`）。 |
| `no-void-catch-return.mjs` | ESLint type-aware 规则（`.catch()` 回调不得返回 void）。 |
| `jelly/` | **git submodule**：Jelly 静态分析器（fork）。 |
| `exec-flows.mjs` | 运行 Jelly，产出调用图基线的脚本（`bun run exec-flows`）。 |
| `exec-flows/` | 生成物：`callgraph.json`（提交为基线）、`callgraph.html` 与 `vendor/`（未跟踪）。 |

## rules/jelly（git submodule）

- 上游：<https://github.com/cs-au-dk/jelly>；本项目固定到 fork
  <https://github.com/AClon314/jelly>。
- 用途：对 gpen-js 源码做调用图 / 库用法分析，产出可 diff 的**执行流**基线。
- 固定版本：submodule 的 gitlink 指向 fork 上带 Svelte 支持的提交。

### 相对上游的改动：Svelte `<script>` 支持

上游只认识 JS/TS 模块，Svelte 组件会被整份跳过。fork 的改动：

- `src/parsing/svelte.ts`（新增）：把组件「掩码」——`<script>` 块内容原样保留，
  其余字符替换为空格、换行保留，所以掩码文本与原文件**行列完全对齐**；解析掩码
  得到的 AST 位置可直接指回原 `.svelte` 文件（诊断、代码片段提取都正确）。
- `src/parsing/parser.ts`：`.svelte` 文件进解析器前先做上述掩码。
- `src/misc/files.ts`：目录展开收录 `.svelte`；模块解析允许 `.svelte`——TS 编译器
  不认 `.svelte`，所以先走 TS resolver（拿到 tsconfig `paths` 别名，如 gpen 的
  `#lib/*`），失败再退回 ESM / CommonJS resolver（相对路径与 package.json
  `imports` 别名）。
- `tests/unit/svelte.test.ts`（新增）：掩码、行列对齐、多 script、属性里含 `>`
  的 `<script>`、解析位置、以及三种模块解析路径。

已知限制：

- `<script context="module">` 与实例 `<script>` 合并成同一个 module（一个文件只有
  一个 AST）；两块顶层**同名**声明会冲突（Svelte 里它们本属不同作用域）。
- 模板里的表达式（`{...}`）不在分析范围内，只分析 `<script>`。

### 构建

```bash
git submodule update --init --recursive
cd rules/jelly
bun install
bun run build        # tsc → lib/
```

> Jelly 上游用 npm/jest；本地用 bun 装依赖、`bun run build` 编译，
> 单测用 `node node_modules/.bin/jest tests/unit`（不用 `bun test`，它跑不了 ts-jest）。

### 运行执行流分析

```bash
bun run exec-flows                    # = node rules/exec-flows.mjs
bun run exec-flows -- --warnings-unsupported   # 额外参数透传给 jelly
```

默认命令（见 `exec-flows.mjs`）：

```bash
jelly -b . --ignore-dependencies --no-print-progress \
      -j rules/exec-flows/callgraph.json \
      -m rules/exec-flows/callgraph.html src
```

脚本随后会把浏览器可视化的前端依赖本地化：jelly 自带的 `visualizer.html` 从
`cdn.jsdelivr.net` 加载 cytoscape 等库，浏览器访问不到该 CDN（离线 / 国内网络 /
客户端走 Tailscale MagicDNS）时页面会全白。`exec-flows.mjs` 生成后把这些资源
镜像到 `rules/exec-flows/vendor/` 并把 URL 改成相对路径，因此只要浏览器能访问
本机 http server 就能渲染。首次生成需要本机有网，之后有 `vendor/` 缓存即可离线。
用浏览器打开时记得强刷（Ctrl/Cmd+Shift+R），避免旧 HTML 被缓存。

**第一次基线**（2025，`src/`，忽略外部依赖）：

- modules 124 (TS) + 38 (`.svelte`) = 162；functions 1717
- fun→fun 调用边 2238；可达函数 81.25%；分析错误 0
- `.svelte` 文件里解析出 405 个函数

后续可基于 `callgraph.json` 做架构依赖 / 调用方向检查（新增规则时再加脚本与 CI）。
