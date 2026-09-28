# rules/ —— 仓库级校验与静态分析

本目录放「机器可执行的仓库规则」：oxlint/ESLint 自定义规则，以及用来生成
**函数级调用图**与**模块级依赖图**基线的静态分析器。所有产物统一写在 `rules/out/`。

## 文件

| 路径                             | 说明                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `catch-must-return-or-throw.mts` | oxlint 自定义规则（catch 块必须有 `return`/`throw`）。                                                         |
| `no-void-catch-return.mjs`       | ESLint type-aware 规则（`.catch()` 回调不得返回 void）。                                                       |
| `jelly/`                         | **git submodule**：Jelly 静态分析器（fork）。                                                                  |
| `graph-func.mjs`                 | 跑 Jelly，产出**函数级**调用图（`bun run graph:func:call`）。                                                  |
| `depcruise/`                     | dependency-cruiser 配置 + **模块级**依赖图脚本（`bun run graph:module:*`）。详见 `rules/depcruise/README.md`。 |
| `out/`                           | **全部产物**（见下）。                                                                                         |

## rules/out（产物）

| 文件                         | 内容                                                                            | 入库？      |
| ---------------------------- | ------------------------------------------------------------------------------- | ----------- |
| `func.json`                  | **图**：模块、函数、调用/import 边（可视化、影响面查询）                        | ✅ **基线** |
| `func-calls.json`            | **调用点索引**：调用点位置与 call→function 边（漏洞调用栈、可达性、未解析边界） | ✅ **基线** |
| `func.log`                   | 与上面两份同一次运行的日志                                                      | ✅ **基线** |
| `module.json` / `module.dot` | 模块级依赖图全量视图（depcruise）                                               | ✅ **基线** |
| `module.mmd` / `module.svg`  | 同一张图的 mermaid / graphviz 渲染                                              | ❌ churn    |
| `module-focus-<slug>.*`      | focus 子图（`<slug>` 由 focus regex 派生）                                      | ❌ churn    |
| `module-overview-<slug>.*`   | 目录级折叠总览                                                                  | ❌ churn    |
| `module-affected-<slug>.*`   | 相对基线 ref 的变更影响面                                                       | ❌ churn    |
| `func.html` / `func-vendor/` | 调用图可视化（**不内联数据**，运行时 fetch `./func.json`）+ 本地化的前端依赖    | ❌ churn    |

`.gitignore` 用「白名单取反」只放行上面 5 个基线文件（不用 `func-*` 通配——`func.html`
并不匹配 `func-*`）。

### 为什么把调用图拆成两份

实测原来那份 319KB 的文件里，`calls`(44.1%) + `call2fun`(11.7%) 占 **55.8%**，
而**可视化和「函数影响面」查询两者都不用** —— 它们只服务调用点级分析（漏洞调用栈、
可达性、未解析边界）。拆开后常见的图查询只读一半的体积，每个文件也各有明确用途。

|                             | 拆分前                            | 拆分后        |
| --------------------------- | --------------------------------- | ------------- |
| 图（`func.json`）           | 319 365 B                         | **160 905 B** |
| 调用点（`func-calls.json`） | （含在上面）                      | 206 271 B     |
| 最长行                      | **37 337 B**（2562 条边压在一行） | **99 B**      |

`func-calls.json` 里的函数下标指 `func.json` 的索引空间（文件里用 `"graph": "func.json"` 自述）。
两份都不带 jelly 写的 `time`（见下）。

### 排版：用 oxfmt，每个元素一行

拆分时顺手把 jelly 的手写排版换成 **oxfmt**（仓库已有的 devDependency）：

```js
// rules/graph-func.mjs
spawnSync(oxfmt, ["--ignore-path=/dev/null", "--write", jsonPath, callsPath]);
```

- 选 oxfmt 而不是 `JSON.stringify(x, null, 1)`：后者会把 `[3, 1]` 展开成 6 行；oxfmt 是
  「每个元素一行、短数组保持内联」，既有逐行 diff 粒度又不至于爆炸。
- 为什么 diff 粒度重要：jelly 原排版把 2562 条边压在**一行 37KB** 里，改一条边就重写整行
  （约 66KB diff）。新排版下同一个改动是 **1 行**（实测 `4117d4116` / `-    [5, 4],`）。
- `--ignore-path=/dev/null` 是因为 `rules/out` 在 `.prettierignore` 里（不想让
  `bun run format` 爬生成物），而 oxfmt 默认会读它。

## 为什么基线要幂等

jelly 写的 `time` 字段、`func.log` 里的绝对路径与 `Analysis time:` 行，每次运行都会变，
会让「提交为基线」变成纯噪音。`rules/graph-func.mjs` 在生成后把这几处去掉/归一化
（终端输出保持原样，信息不丢），使**同一份源码跑两次的产物完全一致**。

> 改动生成逻辑后请跑两次并 `diff`，确认产物幂等。

## 命令

```bash
bun run graph:func:call                            # 函数级调用图 → rules/out/func.json + func-calls.json + func.log + func.html
bun run graph:func:call -- --warnings-unsupported  # 额外参数透传给 jelly
bun run graph:module:deps                          # 模块级全量 → rules/out/module.{json,mmd,dot,svg}
bun run graph:module:focus -- <regex> [--depth 1]  # 子图：focus 模块 ± N 跳
bun run graph:module:overview [--collapse <re>]    # 目录级折叠总览（默认 -S '^src/[^/]+/'）
bun run graph:module:affected [--base <ref>]       # 变更影响面（默认 origin/main）
```

## rules/jelly（git submodule）

- 上游：<https://github.com/cs-au-dk/jelly>；本项目固定到 fork
  <https://github.com/AClon314/jelly>。
- 用途：对 gpen-js 源码做调用图 / 库用法分析，产出可 diff 的**函数级调用图**基线。
- 固定版本：submodule 的 gitlink 指向 fork 上带下述两处改动的提交。

### 相对上游的改动 1：Svelte `<script>` 支持

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

### 相对上游的改动 2：Svelte rune 当编译器宏

`$state(...)` / `$derived(...)` / `$props()` 等是**编译期宏**，不是函数调用。上游把
它们当作对未知全局的调用，于是：

- 每个 rune 都变成一个「未解析 / native-or-external」的调用点（gpen 里 202 个）；
- rune 的结果被污染成 unknown，下游能连的边连不上。

fork 的改动：

- `src/parsing/svelte.ts`：`getSvelteRuneKind()` 分类表，分两类——
  - **`pure`**（`$derived`、`$state.snapshot`）：结果是参数的纯函数 → 只加 `⟦arg⟧ ⊆ ⟦result⟧`；
  - **`mutable`**（`$state`、`$state.raw`、`$state.eager`、`$props`、`$props.id`、`$bindable`）：
    结果可能被分析外的代码重新赋值（`bind:this`、父组件）→ 加 `⟦arg⟧ ⊆ ⟦result⟧` **且** `@Unknown ∈ ⟦result⟧`。
- `src/analysis/operations.ts`：`callFunction()` 在 **`registerCall` 之前**早退（rune 不是调用）。
  另有绑定检查：本地真的声明了 `$state` 时不当 rune。
- **刻意不在表内**：`$effect` / `$effect.pre` / `$effect.root` / `$derived.by` / `$inspect`。
  它们是「回调 rune」，Jelly 现有的外部回调启发式（`invokeExternalCallback`）已经能为
  它们的函数参数连出正确的边，当成 pass-through 反而会丢边。
- `tests/unit/svelte.test.ts`：4 个用例覆盖分类表。

> **维护提醒**：`mutable` 类必须带 `@Unknown`。第一版把它们当纯恒等函数，结果丢了 8 条
> 外部回调边——`Viewport.svelte` 的 `let canvas = $state(undefined)` 原本靠 `@Unknown` 在
> `strokeCanvas.ts` 的 `canvas.addEventListener(...)` 处触发回调启发式。改动分析器后，
> 一定要按**位置**对 `call2fun` 求集合差（不能只看总数：总数持平可能同时藏着「丢 N 条 + 新 N 条」）。

### 构建

```bash
git submodule update --init --recursive
cd rules/jelly
bun install
bun run build        # tsc → lib/
```

> Jelly 上游用 npm/jest；本地用 bun 装依赖、`bun run build` 编译，
> 单测用 `node node_modules/.bin/jest tests/unit`（不用 `bun test`，它跑不了 ts-jest）。
> `bun run build` 在 gpen-js 里会以 exit 1 结束，但这是**预先存在**的：`tsc` 报 82 个
> `error TS`，全部来自 `gpen-js/node_modules/@types/d3-*`（父仓库的 `@types` 被 jelly 的
> tsconfig 自动纳入、缺 DOM lib），`src/` 下 0 个错误，**产物仍会正常 emit**。

### 运行函数级调用图分析

```bash
bun run graph:func:call                          # = node rules/graph-func.mjs
bun run graph:func:call -- --warnings-unsupported # 额外参数透传给 jelly
```

默认命令（见 `graph-func.mjs`）：

```bash
jelly -b . --ignore-dependencies --no-print-progress \
      -j rules/out/func.json \
      --callgraph-html-data ./func.json \
      -m rules/out/func.html src
```

`--callgraph-html-data` 让生成的 HTML **不内联数据**，而是运行时 `fetch('./func.json')`
并在浏览器里现场把原始调用图转成可视化的图。所以 `func.html` 只是一份静态模板
（~31KB，与仓库规模无关），而**提交的 `func.json` 本身就是可打开的可视化数据源**。
代价：页面必须经 http 提供（`file://` 下 `fetch` 被 CORS 拦）；不传该选项时行为与以前一样（内联）。

为此 `func.json` 比通用调用图格式多了三个字段（见 `rules/jelly/src/typings/callgraph.ts`）：
`functionNames`（节点标签）、`moduleNodes`（哪些索引是整个模块）、`requireEdges`（把 import 边
从调用边里区分出来，因为 `fun2fun` 是两者合并的）。

> 与内联版的一个已知差别：JSON 里只有**被分析**的模块（`--ignore-dependencies` 下 162 个），
> 内联版还会把“已抵达但未分析”的依赖模块也画出来（197 个 / 13 个包）。函数数与边数完全一致。

脚本随后会把浏览器可视化的前端依赖本地化：jelly 自带的 `visualizer.html` 从
`cdn.jsdelivr.net` 加载 cytoscape 等库，浏览器访问不到该 CDN（离线 / 国内网络 /
客户端走 Tailscale MagicDNS）时页面会全白。`graph-func.mjs` 生成后把这些资源
镜像到 `rules/out/func-vendor/` 并把 URL 改成相对路径，因此只要浏览器能访问
本机 http server 就能渲染。首次生成需要本机有网，之后有 `func-vendor/` 缓存即可离线。
用浏览器打开时记得强刷（Ctrl/Cmd+Shift+R），避免旧 HTML 被缓存。

### 基线数字（`src/`，忽略外部依赖，2026-09）

```
modules 162 (124 TS + 38 .svelte)   functions 1722
fun→fun 边 2248                     call→fun 边 2460
调用点 4841   只有 0/1 个 callee 65.21%   多个 callee 1.26%
native 或 external 33.53%           零调用者函数 314/1722 (18.23%)
可达函数 82.52%                     0 error / 129 warning
```

后续可基于 `rules/out/func.json` 做架构依赖 / 调用方向检查（新增规则时再加脚本与 CI）。
