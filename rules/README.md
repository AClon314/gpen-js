# rules/ —— 仓库级校验与静态分析

本目录放「机器可执行的仓库规则」：oxlint/ESLint 自定义规则，以及生成**调用图 / 符号索引**的
静态分析器。所有产物统一写在 `rules/out/`。

> **现状**：调用图主线是 **SCIP**（`scip-typescript` fork + `scip-graph` 两个 git submodule；
> `scip-symbol-graph` 是第三方对照原型，只用于评测，不是依赖）；
> **Jelly** 是遗留对照组。已 `trash` 移除 `rules/{joern,codeql,depcruise}/`、旧的 `rules/scip/`
> （callee patch + PoC 脚本）与 `rules/scip-graph-query.mjs`。选型归档见
> `rules/out/callgraph-tooling-comparison.md`，历史 PoC / fork 文档已随 `AClon314/scip-graph` 归档，不在工作区。
>
> **对照工具场**：`rules/cbm/` 是 **codebase-memory-mcp fork submodule**（内含
> `graph-ui-svelte/`、`tools/scip-cbm-writer/` 与 `dev/`）；`rules/cbm-runtime/` 是 npm 运行时。
> 探针 / fixture 已随 `cbm/dev/` 移入 fork；ScubaTrace / Source Atlas / lspgraph / TSA /
> multilspy 已移除。它们是评测/验证用，不是依赖；装好的本体不入库。

## 文件

| 路径                             | 说明                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `catch-must-return-or-throw.mts` | oxlint 自定义规则（catch 块必须有 `return`/`throw`）。                                                  |
| `no-void-catch-return.mjs`       | ESLint type-aware 规则（`.catch()` 回调不得返回 void）。                                                |
| `scip-typescript/`               | **git submodule**（fork，分支 `gpen`）：Svelte + callee/enclosing-range/`display_name` 的 SCIP 索引器。 |
| `cbm/`                           | **git submodule**：codebase-memory-mcp fork；内部挂 `graph-ui-svelte/`（`code-graph`）、`tools/scip-cbm-writer/`，并包含 `dev/`。 |
| `cbm-runtime/`                   | codebase-memory-mcp 0.12.1 npm 运行时（不入库）。 |
| `scip-symbol-graph/`             | **git submodule**（第三方 pin，仅评测/参考）：SCIP 符号结构图原型；取/舍见归档仓库 `AClon314/scip-graph` 的 `docs/`。 |
| `jelly/`                         | **git submodule**（fork）：遗留函数级调用图分析器。                                                     |
| `cbm/dev/`                     | SCIP→cbm 探针 + fixture + demo 脚本；结论见 `out/callgraph-tooling-comparison.md`。 |
| `graph-func.mjs`                 | 跑 Jelly → 函数级调用图（`bun run graph:func:call`）。                                                  |
| `graph-func-classify.mjs`        | Jelly 未解析调用点分类（`graph:func:call` 链式跑）→ `func-boundaries.json`。                            |
| `graph-func-query.mjs`           | 只读 Jelly 基线 json 的影响面查询（`graph:func:{impact,callers,callees}`）。                            |
| `out/`                           | 全部产物（见下）。                                                                                      |

## rules/out（产物）

| 文件                                                        | 内容                                                | 入库        |
| ----------------------------------------------------------- | --------------------------------------------------- | ----------- |
| `func.json`                                                 | Jelly 函数级调用图（图）                            | ✅ **基线** |
| `func-calls.json`                                           | Jelly 调用点索引                                    | ✅ **基线** |
| `func-boundaries.json`                                      | Jelly 未解析调用点分类 A–9                          | ✅ **基线** |
| `func.log`                                                  | 与上面同一次运行的日志（含类别计数）                | ✅ **基线** |
| `callgraph-tooling-comparison.md`                           | 工具选型实测汇总（Jelly / Joern / CodeQL / scip）   | ✅ **报告** |
| `scip-graph.json`                                           | SCIP 派生调用图（当前仓库；`bun run scip:graph:*`） | ❌ churn    |
| `scip-typescript.graph.json` / `scip-graph-self.graph.json` | 上述两个 submodule 自身的调用图（示例）             | ❌ churn    |
| `func.html` / `func-vendor/`                                | Jelly 可视化模板 + 本地化的前端依赖                 | ❌ churn    |

`.gitignore` 用「白名单取反」只放行上表 5 个基线（`rules/out/*` + `!` 取反）；其余 `scip-*` 等
都是可重生成的 churn。`func-calls.json` 里的下标指 `func.json` 的索引空间（文件内 `"graph"` 自述）。

## 命令速查

```bash
# --- SCIP 主线 ---
cd rules/scip-typescript && bun install || true && node_modules/.bin/tsc -b .  # 首次构建索引器
bun run scip:index            # fork 索引器 → rules/out/.cache/scip/index-fork.scip
bun run scip:index:json       # scip print --json → index-fork.json
bun run scip:graph:derive     # 派生 → rules/out/scip-graph.json
bun run scip:graph:callers -- <选择器> [--depth N] [--json]
bun run scip:graph:callees / :impact / :refs / :boundaries

# --- 视图 / 预计算（旧 scip-graph，已归档） ---
bun run dev                                   # 读 static/graph.json
SCIP_GRAPH_FILE=<graph.json> bun run dev      # 换任意仓库的图
bun run precompute:force                      # 缓存 d3-force symbol 布局（秒级）
bun run precompute:elk                        # 离线 elk-stress 干净模式（~2 min）
bun run precompute:all

# --- Jelly 遗留 ---
bun run graph:func:call       # → func.json + func-calls.json + func-boundaries.json + func.log + func.html
bun run graph:func:classify
bun run graph:func:{impact,callers,callees} -- <选择器> [--depth N] [--json]
```

## SCIP 调用图（主工具）

两个 submodule 分工：`scip-typescript` 只产**符号索引**；`scip-graph` 从索引**派生调用图**、
**查询**、**可视化**。

- **派生**：`scripts/derive-graph.ts` 把 SCIP JSON 规整为冻结 schema `gpen-scip-graph/1`——
  `nodes[]`（`id/kind/name/file/line/weight/svelte/range?`）+ `edges[]`
  （`from/to/dispatch/confidence/calls/sites`）。`id` = `<file>:<1-based line>`，与 Jelly 同口径。
- **查询**：`callers` / `callees` / `impact` / `refs` / `boundaries`；`--json` 是唯一机器契约，
  可导出 mermaid / `.dot` 聚焦子图。
- **视图**：`/global`（d3-force Web Worker 密度概览、层级折叠 `dir/file/symbol`、size-by-degree、
  outline 树、`?selected=` URL 同步 + 刷新自动聚焦、离线 elk-stress 干净模式）+
  `/local`（butterfly 列、可调 hop 深度、多焦点中心、半圆拱、键盘导航、编辑器 jump/sync）。
- **换仓库看**：对任意仓库重复 `index → print --json → derive`，再 `SCIP_GRAPH_FILE=<graph> bun run dev`。
  已生成过 `scip-typescript`（195 节点 / 245 边）与 `scip-graph` 自身（468 / 557，含 142 个 svelte 节点）。

**约定与踩坑**

- `.svelte` 判定一律 `endsWith('.svelte')`（`includes` 会误伤 `.svelte.ts`）。
- SCIP 局部符号是**文档作用域**（`local N` 跨文件重名），派生必须按文档解析；名字取自 fork 发的
  `SymbolInformation.display_name`。
- 索引器的 `--output` 相对 `--cwd` 解析，跨目录时用**绝对路径**。
- 只有能解析到 in-repo 定义的边才进图；解析不到的内建 / rune 归 `boundaries`，**不是索引缺失**。
- `range` 只覆盖有定义 occurrence 的节点（无定义的 caller key 没有 range）。
- 预计算布局（`elk-stress` / d3-force cache）是 gitignored 的派生文件，换图后需重跑。

## Jelly 函数级调用图（遗留对照组）

仍产出可 diff 的函数级基线，用于与 SCIP 对照，**不是**主工具。fork 相对上游的两处改动
（细节见归档仓库 `AClon314/scip-graph` 的 `docs/`）：

1. **Svelte `<script>` 掩码**：`<script>` 内容原样、其余替换为空格且保留换行 → 行列与原文件对齐；
   目录展开收录 `.svelte`；模块解析先走 TS（拿 tsconfig `paths` 别名），失败回退 ESM/CJS。
2. **rune 当编译器宏**：`$state`/`$derived`/`$props` 等不再记成调用点（`pure` 恒等；
   `mutable` 另加 `@Unknown`）。`$effect`/`$derived.by` 等回调 rune **刻意不在表内**——
   现有的外部回调启发式已能为其函数参数连出正确的边。

基线（`src/`，忽略依赖，2026-09）：`162 modules（124 TS + 38 .svelte）· 1722 functions ·
2248 fun→fun 边 · 4841 调用点 · native/external 33.53%`。

**约定与踩坑**

- `--ignore-dependencies` **故意**断开依赖边；跨 repo / 依赖问题用 SCIP 看，别把两套数字混口径。
- 构建：`cd rules/jelly && bun install && bun run build`（上游用 npm/jest；单测用
  `node node_modules/.bin/jest tests/unit`）。`bun run build` 会以 exit 1 结束，但报错全来自父仓库
  带入的 `node_modules/@types/*`，`src/` 0 错、产物正常 emit。
- 产物幂等：生成时归一化 jelly 写的 `time`、绝对路径与 `Analysis time:`；改生成逻辑后跑两次 `diff`。
- `func.html` 不内联数据、运行时 `fetch('./func.json')`：必须经 http 打开，且强刷避免旧缓存。

## 未解析边界（两套口径，别混）

| 工具  | 命令                    | 口径                                                                                                                                                                                                |
| ----- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCIP  | `scip:graph:boundaries` | 读 fork 索引里 callee 落不到 in-repo 定义的调用点，粗分 `runes / builtins / node_modules / unclassified`（大头是 JS 内建与 Svelte 宏，**不是缺失**）。                                              |
| Jelly | `func-boundaries.json`  | 用 TS checker 在调用点源码位置解析 callee，归 `A` native / `B` external / `C1` 注入回调 / `C2` **本仓库真漏（重点盯）** / `D` 仓库外 / `I` import / `U` TS 归类不了（`.svelte`/生成物）/ `9` 动态。 |

Jelly 侧分类只覆盖未解析调用点（`calls − call2fun`，当前 2185 个），且是位置 id 索引——
**源码增删一行会让后续 id 整体位移**，diff 大属预期；`func.log` 记各类计数，用于分布回归。

## 对照工具（cbm/dev）

```bash
cd rules/cbm/dev
./run.sh --setup                # 只装 codebase-memory-mcp 0.12.1 + writer 依赖
./run.sh                        # 硬 fixture → SCIP → writer → cbm → code-server GUI
./run.sh --vite                 # 同上，但 UI 走独立 Vite（历史 run-demo.sh 仍保留）
```

只读结论：[`out/callgraph-tooling-comparison.md`](out/callgraph-tooling-comparison.md)。
一句话：`scip-typescript` fork 继续保留；SCIP 产 cbm 兼容 SQLite，查询/UI/MCP/编辑器跳转
复用 codebase-memory-mcp；`scip-graph` 只保留「类型化 Svelte IR + diff/TUI」。

## 通用提醒

- 下游（AI / 脚本）一律消费 `--json`，不解析人类视图。
- 改任何生成逻辑后连跑两次确认幂等。
- `rules/out` 是 churn 区，只有上表 5 个基线入库。
