# 调用图工具横向评测（2026-10）

> 目的：回答「既然已经有 ScubaTrace / Source Atlas / lspgraph / codebase-memory-mcp /
> tree-sitter-analyzer / multilspy，基于 SCIP 的 `scip-graph` 还有没有必要」。
>
> 所有工具都已在本机 `rules/cbm/dev/` 装好并跑过：**8 文件 fixture**（TS + Svelte + Python）+ **3 文件 Java fixture** + **本仓库 `src/` 真实语料**。复现见 [`../cbm/dev/README.md`](../cbm/dev/README.md)。
>
> 评测日期 2026-10-20。版本：ScubaTrace 1.1.3 / Source Atlas 0.1.9 / lspgraph 0.1.2 /
> codebase-memory-mcp 0.12.1 / tree-sitter-analyzer 2.2.0 / multilspy 0.1.1 / Neo4j 5.14.0 /
> scip-typescript fork（`gpen` 分支）。
>
> **2026-10 更新**：ScubaTrace / Source Atlas / lspgraph / TSA / multilspy 的部署已从
> `peers/` 移除，结论保留为历史记录；cbm 源码 fork 在 `rules/cbm/`，npm 运行时在 `rules/cbm-runtime/`；`rules/cbm/dev/`
> 只留 SCIP→cbm 探针 + fixture。lspgraph-core 不作为运行时依赖（理由见 §7.5）。
> 新增“SCIP → cbm 兼容 SQLite”（§7.5）与 `.scip` 直读（§7.7）的实测。

---

## 0. 结论

**没有一款能直接替掉 SCIP 索引器；但有一款能替掉「AI 代码分析产品」的大部分。**

| 判断 | 工具 | 理由 |
| --- | --- | --- |
| 库设计最好，但本项目不用 | **lspgraph-core** | Rust crate，`Config/LanguageServer/Engine/CallGraph`，加语言零代码；但 lazy/cache/TS 覆盖/无 Svelte 不匹配持久索引 |
| **最好嵌的 Python 粗粒度图** | **tree-sitter-analyzer** | `call_graph.CallGraph` 直接可调，0.45s 扫完 `src/`；但无语义类型、无 Svelte |
| **产品级替代 / 对手** | **codebase-memory-mcp** | 162 语言 + Svelte + SQLite + MCP + 2s 索引；MIT；但不是库，是 330MB 进程 |
| **只做 LSP 实时层次** | **lspgraph** | 纯 LSP，零索引器；但 lazy、cache 未接线、TS 覆盖天然不足 |
| **不值得引入** | ScubaTrace | GPL-3.0 传染 + 实测 bug（空 DOT、callers 崩溃、`override` 当函数名） |
| **不值得引入** | Source Atlas | 0.1.9 alpha，实际只有 Java analyzer，必须 Neo4j+APOC，边无 callsite |
| **底层 plumbing** | multilspy | 只是 LSP 客户端；`references` 连 import 一起返回，调用图要自己过滤 |

**对 `scip-graph` 的判断（分层）：**

1. **作为「调用图产品」**：没有必要。cbm 已经覆盖语言、Svelte、持久化、查询、UI、MCP，
   而且比自研快一个数量级。继续重写等于重新实现它已交付的部分。
2. **作为「类型化 Svelte/TS + 可 diff 的符号 IR」**：仍然必要，而且是唯一选项。
   没有任何对照工具消费 SCIP，也没有一个在 `.svelte` 上做类型解析：
   - SCIP fork：`.svelte` 38 个文档，414 个 Svelte 节点，329 条 Svelte→Svelte 边；
   - cbm：`.svelte` 靠 tree-sitter（763 个节点、235 条 Svelte→Svelte CALLS），是**语法级**；
   - TSA / ScubaTrace / lspgraph / Source Atlas：**0 个 `.svelte` 组件**。
3. **现状提醒**：`rules/scip-graph` 的 `main` 目前只到 M1（IR / view-model / 渲染），
   `scripts/derive-graph.ts` 与查询 CLI 还在 `deprecated-202609`。父仓库
   `bun run scip:graph:derive` 现在会因找不到 `scripts/derive-graph.ts` 失败。
   也就是说，**今天真正能跑的图管线在历史分支**；新仓库继续走，需要先把 M2 补回来。

**一句话建议**：保留 `scip-typescript` fork；把 `scip-graph` 的定位收窄到
「类型化 Svelte/TS → 稳定 IR → diff/双面渲染」；查询、持久化、跨语言、agent 接口优先复用
cbm，不再自研。三周内要出产品的话，直接让 cbm 做后端。

**关键新证据（§7.5）**：cbm 的读侧就是 SQLite。按它的 schema 写入 SCIP 结果后，
`trace_path / query_graph / search_graph / get_code_snippet` 和 UI `/api/symbol`、`/api/trace`
全部直接可用，**不需要改一行 C**。因此“fork cbm”可以先降级为“写一个 SCIP→cbm 的 writer”。

---

## 1. 部署

历史安装位置为 `rules/cbm/dev/`；cbm 源码在 `rules/cbm/`，运行时在 `rules/cbm-runtime/`；安装脚本与版本见 [`../cbm/dev/README.md`](../cbm/dev/README.md)。
可入库的只有脚本、fixture、driver 和本报告；venv / 二进制 / 索引产物都不入库。

| 工具 | 入口 | 本机实测入口 |
| --- | --- | --- |
| ScubaTrace | Python `Project` / `Function` | `peers/scubatrace/.venv/bin/python peers/scubatrace/driver.py` |
| Source Atlas | Python `AnalyzerFactory` / CLI | `peers/source-atlas/.venv/bin/python -m source_atlas analyze` |
| lspgraph | Rust `lspgraph-core` + TUI | `peers/lspgraph/consumer`（cargo） |
| codebase-memory-mcp | MCP / CLI | `cbm/node_modules/.bin/codebase-memory-mcp cli` |
| tree-sitter-analyzer | Python `CallGraph` / CLI / MCP | `peers/tsa/.venv/bin/python peers/tsa/driver.py` |
| multilspy | Python LSP 客户端 | `peers/multilspy/.venv/bin/python peers/multilspy/driver.py` |

---

## 2. 评测方法

### 2.1 Fixture

[`../cbm/dev/fixtures/callgraph-ts`](../cbm/dev/fixtures/callgraph-ts)：8 个源文件，专门覆盖调用图难例。

```
src/c.ts        c(), cAlias() -> c()
src/b.ts        b() -> c(); b2() { const local = () => c(); local() }
src/svc.ts      Base.go() -> this.helper(); Svc.helper() -> c(); runSvc(r: Runner) -> r.go()
src/hof.ts      apply(fn) -> fn(); arrow = () => c(); viaApply() -> apply(arrow); viaCallback() -> apply(() => c())
src/dyn.ts      dispatch(h) -> h.handle(); computed(obj,key) -> obj[key](); unresolved() -> 外部
src/main.ts     run() -> 上面全部 + new Svc()
src/Comp.svelte local() -> b(); $: value = local()
src/py/mod.py   py_a() -> py_b(); py_entry() { fn = py_a; fn() }
```

人工标注 **26 条 name 级 ground-truth 边**（含构造函数、Svelte、Python；不含 `apply -> fn`、
`computed -> obj[key]` 这类静态不可解边，也不把 `viaApply -> arrow` 这种“把函数当参数传”算成调用）。

### 2.2 真实仓库

`src/`：124 个 TS/TSX（含 `*.svelte.ts`）+ 38 个 `.svelte` + demo 路由，共 125 个 TS 文件。
对比同一棵树，不混口径。

### 2.3 口径声明

- SCIP 的边来自 **`deprecated-202609` 的 `scripts/derive-graph.ts`**。新 `main` 没有迁移该脚本，
  所以这是“历史实现能力”，不是新仓库现状。复现脚本会从 jj 历史里取。
- 各工具的“边”语义不同：cbm 有 `CALLS` / `USAGE` / `DEFINES` 等多种边，这里只取 `CALLS`；
  TSA/Scuba/lspgraph/SCIP 只取函数→函数调用边。
- P/R 是 fixture 上的手标对照，用来暴露差异，不是绝对质量分。
- **语言范围**：只实测 TS/TSX、`.svelte`、Python、Java。Go / Rust / C++ 需要
  gopls / rust-analyzer / clangd，本机未装，且不是本仓库目标；各工具“162 语言 / 13 语言”的
  宣称未逐一验证。

---

## 3. 真实仓库规模与速度

| 工具 | 耗时 | 产出 | Svelte | 备注 |
| --- | ---: | --- | ---: | --- |
| **tree-sitter-analyzer** | **0.45s** | 974 functions / 2262 edges | **0** | 单进程，纯 tree-sitter + import 解析 |
| **codebase-memory-mcp** | **2.0s** | 2763 nodes / 7817 edges（**1484 CALLS**） | **763 nodes / 235 s2s CALLS** | 单二进制，SQLite 持久化，自动排除 `node_modules` |
| **scip-typescript fork** | 3.9s（索引）+ print/derive | 163 docs（38 Svelte）/ 1780 nodes / 2001 edges | **414 nodes / 329 s2s edges** | 类型化符号，含 `display_name`、`enclosing_range` |
| **lspgraph-core** | 7.3s | 723 nodes / 869 edges（1269 callables） | 0 | 纯 LSP；1269 个可调用对象只有 723 个拿到层次 |
| **ScubaTrace** | 12.0s | 441 functions | **0** | 会扫 `node_modules`；这里 root 已指到 `src/` |
| **Source Atlas** | ~10s（Java fixture） | 4 CALL 边 | 0 | TS 直接 `Unsupported language` |

> cbm 的 7817 条是全部边类型；只算 `CALLS` 是 1484 条。SCIP 的 2001 条是纯调用边。
> 两者不可直接比大小，但量级和覆盖率可见。

---

## 4. Fixture 精度

| 工具 | 产出边 | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **lspgraph** | 21 | 21 | 0 | 5 | **100%** | **81%** |
| **tree-sitter-analyzer** | 20 | 19 | 1 | 7 | **95%** | 73% |
| **codebase-memory-mcp** | 26 | 24 | 2 | 2 | 92% | **92%** |
| **ScubaTrace** | 17 | 15 | 2 | 11 | 88% | 58% |
| **SCIP（deprecated derive）** | 28 | 23 | 5 | 3 | 82% | 88% |
| **Source Atlas** | — | — | — | — | — | TS 不支持 |

读表要点：

- **lspgraph 精度最好**：LSP 的 `callHierarchy` 只吐真实调用，不做名字匹配；代价是覆盖不足
  （嵌套箭头函数、`const arrow`、Svelte、Python 全缺）。
- **cbm 覆盖最好**：连 `arrow -> c`、`b2 -> local -> c`、Svelte 的 `local -> b`、Python 的
  `py_entry -> py_a` 都对；两条 FP 是回调属性边（`handle -> b`、`k -> b2`），本质是
  “属性函数体里调了谁”，算不算 FP 取决于粒度。它漏的两条都是**接口参数派发**
  （`dispatch -> handle`、`runSvc -> go`）。
- **TSA 把嵌套闭包折叠**：`b2 -> local -> c` 变成 `b2 -> c`，所以严格算 1 FP + 2 FN；
  但它 0.45s 的速度和跨语言单图是独一档。
- **ScubaTrace 的问题不是覆盖，是正确性**：
  - `override helper()` 被解析成函数名 `override`；
  - `Base.go() -> this.helper()` 自调用被丢弃；
  - `viaApply -> arrow` 把“函数当参数传”误判成调用；
  - `Function.callers` 在 fixture 上抛 `AttributeError`；
  - `Project.export_callgraph()` 对 JS 项目输出空 DOT（`digraph "" {}`）。
- **SCIP 的 5 条 FP 里 2 条是 module 伪节点**（`main.ts -> b`、`hof.ts -> c`）、1 条自环
  （`apply -> apply`），另外 2 条是回调属性 / 响应式语句边（`k -> b2`、`value -> local`，本身是真调用）；把 module 折回外层函数后只剩 1 条真 FP，并补回
  `viaCallback -> c`。这也暴露了旧 derive 的两个结构性问题：**只保留边上的节点**
  （孤立函数消失）、**module 级调用不归属外层函数**。

---

## 5. 难例矩阵

| 难例 | cbm | TSA | lspgraph | ScubaTrace | SCIP fork |
| --- | --- | --- | --- | --- | --- |
| 跨文件静态调用 `b -> c` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 嵌套闭包 `b2 -> local -> c` | ✅ 两段 | ⚠️ 折叠成 `b2 -> c` | ⚠️ 只有 `b2 -> local` | ⚠️ 折叠 | ✅ 两段 |
| 高阶回调 `viaCallback -> c` | ✅ | ✅ | ✅ | ✅ | ⚠️ 归到 module 节点 |
| 接口参数派发 `dispatch -> handle` | ❌ | ❌ | ✅ | ❌ | ✅ `virtual` |
| 接口参数调用 `runSvc -> go` | ❌ | ✅ | ✅ | ❌ | ✅ |
| 构造函数 `run -> Svc` | ✅ | ❌ | ✅ | ❌ | ✅ |
| 方法覆盖 `Svc.helper -> c` | ✅ | ✅（按行区分） | ✅ | ❌（名字错成 `override`） | ✅ |
| 动态属性 `computed -> obj[key]` | ✅ 正确不连 | ✅ 正确不连 | ✅ 正确不连 | ✅ 正确不连 | ✅ 正确不连 |
| 函数当参数传 `viaApply -> arrow` | ✅ 不误连 | ✅ | ✅ | ❌ 误连 | ✅ 不误连 |
| `.svelte` 组件 | ✅ 语法级 | ❌ | ❌ | ❌ | ✅ 类型级 |
| 同一张图跨 Python/TS | ✅ | ✅ | ❌ 分语言跑 | ⚠️ 分语言跑 | ❌ 需另接 indexer |
| 全量离线图 | ✅ SQLite | ✅ | ❌ lazy | ⚠️ 需入口点 | ✅ JSON |

---

## 6. 逐工具

### 6.1 ScubaTrace 1.1.3（GPL-3.0-or-later）

**它是什么**：Tree-sitter + 自带 fork 的 multilspy（`Scubalspy`）+ 可选 Joern，做 AST/CFG/DDG
和调用图。定位是 “toolkit”，API 设计确实是给二次开发用的。

**可嵌入性**：✅ 代码层面可以。

```python
project = scubatrace.Project.create(root, scubatrace.language.JAVASCRIPT)
for fn in project.functions:
    fn.callers         # dict[Function, list[Statement]]
    fn.callees         # dict[Function | DummyFunction, list[Statement]]
    fn.export_callgraph(out, depth=3)   # networkx MultiDiGraph
project.export_callgraph(outdir)        # 需要 entry_point
```

**可扩展性**：每种语言一个包（`javascript/`、`python/`…），各自实现 Parser/Project/File/
Function/Statement。加语言要补整套，不是配置项。

**实测问题**（都在 fixture 上复现）：

- `Project.export_callgraph()` 对 JS 项目写出的 `callgraph.dot` 是空的——JS 没有 `entry_point`，
  整图构建直接返回空图；只有 `Function.export_callgraph()` 可用。
- `Function.callers` 在 `c` 上抛 `AttributeError: 'NoneType' object has no attribute 'name'`。
- `override helper()` 的函数名被吃成 `override`。
- `this.helper()` 被当成 self-reference 丢掉（`Base.go` 的 callee 为空）。
- `viaApply -> arrow` 把实参当调用。
- 默认遍历 `node_modules`，没有 ignore 选项（fixture 首次跑出 2049 个函数）。
- 没有 `.svelte`（扩展名只有 `js`/`ts`；`*.svelte.ts` 会被当 TS 收进来）。

**结论**：技术上可嵌入，**工程和许可证上都不建议**。GPL-3.0-or-later 对闭源产品是硬约束；
质量还没到能当依赖的程度。只适合当“多语言 CPG/切片”的参考实现。

---

### 6.2 Source Atlas 0.1.9（MIT，alpha）

**它是什么**：Tree-sitter + LSP + Neo4j 的代码知识图谱，主打 Java/Spring。

**可嵌入性**：✅ 解析层可以。

```python
analyzer = AnalyzerFactory.create_analyzer("java", root_path, project_id, branch)
with analyzer:
    chunks = analyzer.parse_project(Path(root), export_output=False)
# chunk.methods[*].method_calls -> 调用名
```

**可扩展性**：⚠️ 有 `extractors/{java,python,go,typescript}`，但 `analyzers/` **只有 Java**。
CLI 虽然接受 `--language python|go|typescript`，实际会 `Unsupported language`。要支持 TS 得自己写
analyzer。

**实测**（Java fixture）：

- `A.run -> helper`、`A.run -> C.doit`、`A.run -> B.go`、`B.go -> C.doit`，4/4 正确。
- 但边是 `:CALL`（README 写的是 `CALLS`），按 `method_name` 字符串匹配，**没有 callsite/行号**。
- 必须 Neo4j + APOC；默认镜像没有 APOC，会报 `apoc.create.node` 不存在。
- root 选错会得到 `src.com.example.A.helper()` 这种前缀，目标节点匹配不上，**0 条边**且不报错。
- `--skip-neo4j` 仍然强制要求 `APP_NEO4J_PASSWORD`。

**结论**：对本项目没有直接价值。唯一可借鉴的是它的 `CodeChunk + Neo4j` 数据模型；
但你的 IR 已经比它稳定。不要引。

---

### 6.3 lspgraph 0.1.2（MIT OR Apache-2.0）

**它是什么**：纯 LSP 客户端的调用图探索器。不写索引器，语言支持靠 `servers.toml`。
`lspgraph-tui` 是 TUI；`lspgraph-core` 是引擎库。

**可嵌入性**：✅ **这一批里最好的库设计**。

```rust
let cfg = Config::from_toml(&fs::read_to_string("servers.toml")?)?;
let server = LanguageServer::start(&lang, &cfg.servers[&lang], &root)?;
wait_until_ready(&server, &files, &lang, &ReadinessConfig::default())?;
let mut engine = Engine::new(server);
let id = engine.seed(&candidate)?.unwrap();
let exp = engine.expand(&id)?;          // callers + callees
engine.graph().callees_of(&id);
engine.shutdown()?;
```

[`../peers/lspgraph/consumer`](../peers/lspgraph/consumer) 就是 100 行左右的完整消费者，已跑通。

**可扩展性**：✅ 加语言只改 `servers.toml`（`cmd` / `extensions` / `ready_timeout_secs`），零代码。
前提是该 server 实现 `callHierarchyProvider`。

**实测**：

- fixture：21 条边、**0 FP**，`dispatch -> handle`、`new Svc()`、override 都正确。
- `src/`：7.3s，125 文件 / 1269 个可调用对象 → 723 节点 / 869 边，39 个 `Unresolved`。
  也就是说 **43% 的可调用对象没有 call hierarchy**——这是 LSP 的固有覆盖，不是 bug。
- README 自己承认：cache 能序列化但**没有任何调用方**；crawl 串行；`concurrency` 配置项没有实现。

**结论**：

- 如果产品的核心就是“实时、按符号展开的 call hierarchy”，它是好库；但本项目要的是
  持久索引 + 编辑器跳转，它的 lazy/cache/TS 覆盖都不匹配 → **不进入运行时，留作评测对照**。
- 如果你要“全仓库持久索引 + 类型 + Svelte”，它不是；它的 lazy 模型和你的 IR 目标不同。
- `.svelte` 不在扩展表；即使加 svelte-language-server，call hierarchy 支持也要另外验证。

---

### 6.4 codebase-memory-mcp 0.12.1（MIT）

**它是什么**：单二进制（330MB）的本地 MCP server，把代码索引成 SQLite 知识图谱。
162 种语言，12 种语言有 “Hybrid LSP”（内嵌的 C 类型解析，不启语言服务器）。

**可嵌入性**：❌ **不是库**。

- 对外只有 MCP（stdio）、CLI、`--ui` HTTP 和 SQLite 文件。
- PyPI/npm 包只是下载器的壳；没有 Python/Rust/TS 的 API 可以 `import`。
- 要“集成”就是起子进程说 MCP，或直接读 `~/.cache/codebase-memory-mcp/` 的 SQLite
  （schema 不是公开契约）。

**可扩展性**：⚠️ 有限。

- `extra_extensions` 可以把新后缀映射到已有语言（如 `.blade.php -> php`）。
- 原生就认识 `svelte`、`vue`、`tsx` 等。
- 但 Hybrid LSP 的语言清单是写死的（Py/TS/JS/JSX/TSX/PHP/C#/Go/C/C++/Java/Kotlin/Rust/Perl），
  **Svelte 不在其中**；想改语义得改它的 C 实现。

**实测**：

- fixture：26 条边、P92/R92，覆盖最全；`arrow -> c`、`b2 -> local -> c`、Svelte
  `local -> b`、Python `py_entry -> py_a` 全对。
- 漏 `dispatch -> handle`、`runSvc -> go`（接口参数），这是静态类型推断的常见边界。
- `src/`：2.0s、2763 nodes / 7817 edges（1484 CALLS）、763 个 `.svelte` 节点、
  235 条 Svelte→Svelte CALLS。
- 自动排除 `node_modules`；持久化 `.codebase-memory/graph.db.zst`；支持 openCypher 子集查询。

**结论**：**如果目标是“AI 代码分析产品”，它是替代自研图管线的最优解**。
MIT、快、语言全、Svelte 能用、MCP 生态直接接。代价是：符号身份/IR/schema 都不归你，
不能做 SCIP 级跨仓库符号合并，也不能定制语义。适合“后端 + 薄 UI”，不适合“平台基础设施”。

---

### 6.5 tree-sitter-analyzer 2.2.0（MIT）

**它是什么**：面向 AI agent 的 tree-sitter 代码智能 MCP/CLI，13 种语言有完整调用图索引，
另有 8 种只做符号索引。体量很大（361 个 CLI flag、健康度、约束 DSL、PR review 等）。

**可嵌入性**：✅ **Python 里最好嵌**。

```python
from tree_sitter_analyzer.call_graph import CallGraph
cg = CallGraph(root); cg.build()
cg.callees_of("run"); cg.callers_of("c"); cg.call_chain("run", depth=3)
cg.all_call_edges()
```

另有 `tree_sitter_analyzer/api/` 公开嵌入入口。只 import `CallGraph` 不会拉起 MCP。

**可扩展性**：✅ 22 个语言插件、注册表；加语言是写 Python plugin（不是改核心）。
代价是依赖重：`mcp`、`numpy`、`anthropic`、`detect-secrets`、`networkx` 等。

**实测**：

- fixture：20 条边、P95/R73。
- 同一张 `CallGraph` 能同时装 TS 和 Python（18 个函数，含 `py_a -> py_b`）。
- 嵌套闭包被折叠：`b2 -> local -> c` 变成 `b2 -> c`；`const arrow` 不被当作函数；
  构造函数 `new Svc()` 不连；接口派发 `dispatch -> handle` 不连。
- `src/`：**0.45s**、974 functions / 2262 edges。
- **0 个 `.svelte`**：`SUPPORTED_EXTS` 不含 svelte，组件直接跳过。
- CLI 路径下大量边 `callee_resolution: "unknown"`，仍按名字连边。

**结论**：**最快的粗粒度跨语言基线**。适合做 fallback、对照 oracle、或“先有个图”的 MVP；
不适合做类型级核心。它的调用图是 tree-sitter + import/name 解析，不是 SCIP 级语义。

---

### 6.6 multilspy 0.1.1（MIT）

**它是什么**：微软研究院的 LSP 客户端库，为上层分析工具提供统一 API。支持 12 种语言服务器，
自动下载/启动/管理生命周期。

**可嵌入性**：✅ 库，但不是调用图库。

- `request_references(file, line, col)` 返回**所有引用**，包括 `import { b } from './b'`，
  所以直接拿它当 callers 会多出 import/类型引用。
- 没有 `prepareCallHierarchy` / `incomingCalls` / `outgoingCalls` 的高层封装；
  要做调用图，得自己过滤 references 或自己发 LSP 请求。
- `request_definition` / `documentSymbols` / `hover` 可用。

**实测**：fixture 上 27 symbols / 51 references；其中 `b` 的 references 包含 3 条
`main.ts`（2 条 import/引用 + 1 条调用），必须靠语法/位置再过滤。

**结论**：底层 plumbing。**lspgraph-core 已经在它之上把“调用图”包好了**；
除非你要发 LSP 的其它请求（completion、hover、自定义 method），否则没有理由直接用它。

---

## 7. `scip-graph` 还要不要？

### 7.1 先看三个差异化

| 差异化 | 谁能替代 | 结论 |
| --- | --- | --- |
| **类型化 Svelte/TS 符号** | 无。cbm 的 Svelte 是 tree-sitter 语法级；TSA/Scuba/lspgraph 完全不认 `.svelte` | 保留 fork 的核心理由 |
| **稳定、可 git/jj diff 的 JSON IR** | 无。cbm=SQLite、source-atlas=Neo4j、TSA=响应 JSON、lspgraph=内存 | 保留 derive 的理由 |
| **自己的 TUI/GUI 双面渲染** | 有替代但形态不同：cbm Lens（beta Web UI）、lspgraph TUI、TSA Mermaid | 只有“双面 + 可 diff”是独有 |

### 7.2 再看三种产品形态

**A. Agent / CLI 的代码智能**（“谁调用 X”“改这个影响什么”）

- cbm 已经覆盖 90%，而且 2 秒索引、162 语言、Svelte、MCP 原生。
- 自研增量只有：类型化 Svelte 边界、你的 `boundaries` 分类、SCIP symbol identity。
- 如果这些不是卖点：**删 `scip-graph`，用 cbm 做后端**，viewer 只做展示层。

**B. 可视化 / 可 diff 的调用图浏览器**（TUI + GUI，`git diff` 两张图）

- 这是 `scip-graph` 唯一明显差异化的场景。
- 但“有图”不稀缺：cbm 有 UI、TSA 有 Mermaid、lspgraph 有 TUI。
  你真正独有的是 **IR 可 diff** + **同一个 view-model 驱动 TUI/GUI**。
- 继续做的话，**只做这两件事**：M2 derive（含 isolated nodes）+ 查询 + 渲染；
  不要再自研 LSP、跨语言 parser、持久化、MCP 协议。

**C. 平台基础设施**（符号 ID 跨仓库/跨语言可合并、可增量）

- SCIP 是唯一有开放 symbol scheme 的。其它工具都不吃 SCIP，采用它们 = 放弃 SCIP identity。
- 这时保留 SCIP 不是“要不要”，而是“必须”；但非 TS/Svelte 语言可以交给
  cbm 的 Hybrid LSP（或 TSA 粗粒度）补，不必自己写；lspgraph 只留作评测。

### 7.3 建议的落地组合（2026-10 修正）

```
scip-typescript fork（保留，Svelte + display_name + enclosing_range）
        │
        ├─ SCIP JSON → scip-to-cbm writer → cbm schema v3 SQLite
        │        ├─ cbm MCP：trace_path / query_graph / search_graph / get_code_snippet
        │        ├─ cbm UI：/api/symbol|trace|impact|layout + Monaco
        │        └─ cbm-nav LSP/CLI → VSCode / fresh 跳转
        │
        └─（可选）scip-graph IR → 可 git/jj diff 的图 + 自己的 TUI/GUI
```

**明确不做**：

- 不引入 ScubaTrace（GPL + 质量）。
- 不引入 Source Atlas（Java-only + Neo4j + alpha）。
- **不把 lspgraph-core 当运行时依赖**：lazy 模型、cache 未接线、TS 覆盖 723/1269、无 Svelte；
  留着当评测对照即可。
- 不深改 cbm 的 162 语言 parser：SCIP 只接管 TS/TSX/Svelte 的 `CALLS`，其余语言继续用 cbm。
- 不再把“有调用图”当成卖点；卖点应是“类型化 Svelte + 可 diff 的 IR + 编辑器跳转”。

### 7.4 如果继续 `scip-graph`，M2 必须补的两件事

1. **孤立节点**：旧 derive 的节点集合来自边（`nodeIds` 只加 `edge.from/to`）。结果
   `openWorkspace` / `minimizeWorkspace` / `persistBallPosition` / `restoreWorkspace`
   这些**只被模板引用、不被调用**的函数直接消失。对 AI 分析（死代码、影响面）是硬伤。
   已实测：`GpenOverlay.svelte` 里它们完全没有节点。
2. **module 级调用归属**：`main.ts -> b`、`hof.ts -> c` 来自内联回调/模块顶层调用；
   `file:1` 的 module 节点会把它们吸走。应归属到最近的外层函数（或保留但标 `dispatch=module`）。

另外，旧 derive 的 `apply -> apply` 自环应过滤（`dispatch: "self"` 现在只是标注，没有剔除）。

### 7.5 SCIP → cbm：实测可行（不需要改 C）

这一节是 2026-10 追加的关键实验。结论：**cbm 的读侧（MCP + UI）就是一个 SQLite DB；
按它的 schema 写入，SCIP 可以不经任何 C 代码直接成为 cbm 的调用图后端。**

#### cbm 的前后端架构（读源码确认）

| 层 | 实现 | 位置 |
| --- | --- | --- |
| 索引器 | C + vendored tree-sitter（162 语言），并行 worker | `internal/cbm/`、`src/pipeline/` |
| 调用解析 | `pass_calls.c`：import_map 0.95 / same_module 0.90 / unique 0.75 / suffix 0.55，边属性带 `confidence/strategy/line` | `src/pipeline/pass_calls.c` |
| 图缓冲 | `cbm_gbuf_*`：QN 索引 + 边去重，最后 dump SQLite | `src/graph_buffer/` |
| 存储 | SQLite `nodes(id,label,name,qualified_name,file_path,start_line,end_line,properties)`、`edges(source_id,target_id,type,properties)`；`PRAGMA user_version=3` | `src/store/store.c`、`internal/cbm/sqlite_writer.c` |
| 查询 | SQLite + 内存邻接（`graph_mem`）+ openCypher 子集 | `src/store/`、`src/cypher/` |
| MCP | 15 个工具，stdio JSON-RPC；长驻 daemon | `src/mcp/mcp.c`、`src/daemon/` |
| UI | React 19 + Vite + Monaco + three.js，构建时嵌入二进制；走 `/api/symbol|trace|impact|layout` | `graph-ui/`、`src/ui/http_server.c` |
| 构建 | `scripts/build.sh --with-ui` → `build/c/codebase-memory-mcp` | `Makefile.cbm` |

关键点：**没有 Go/Rust 后端**。核心是 700+ 个 C 文件 + 1.3GB vendored grammar；UI 是 React/TS。
所以“fork cbm 改后端”≈ 在 C 里工作，这是最大的认知负担，不是 SCIP。

#### 外部写库实验

[`../cbm/dev/scip-cbm-probe.py`](../cbm/dev/scip-cbm-probe.py) 把 `scip print --json` 的输出写成
cbm schema v3 的 SQLite（Project/Folder/File/Module/Function/Method/Class + `CONTAINS_*` +
`CALLS`，边属性带 `confidence=1.0, strategy="scip", line, column, sites[]`），然后直接调用 cbm：

```bash
python3 rules/cbm/dev/scip-cbm-probe.py rules/cbm/dev/out/scip/fixture.json scip-probe \
  rules/cbm/dev/fixtures/callgraph-ts

codebase-memory-mcp cli --json trace_path --function-name run --project scip-probe \
  --direction outbound --depth 1 --format json
codebase-memory-mcp cli --json query_graph --project scip-probe \
  --query "MATCH (a:Function)-[r:CALLS]->(b:Function) RETURN a.name,b.name"
```

实测全部通过：

- `list_projects` / `search_graph` / `query_graph` / `trace_path` / `get_code_snippet` ✅
- UI HTTP：`/api/symbol`、`/api/trace` 直接返回正确 JSON ✅
- `trace_path` 的 1/2 跳结果与 cbm 自己索引的 fixture 一致（`run` 11 个 callees、
  `c -> cAlias/b/helper` 等）✅

#### 这说明什么

- **不需要 fork 700 个 C 文件就能复用 cbm 的 MCP + UI + 查询**。只要有“SCIP → cbm schema”
  的 writer，前端、查询、编辑器跳转都能直接用。
- 需要补的只有三块：
  1. **文件树/容器节点**：UI 的 `/api/tree`、`/api/layout` 需要 `Folder/File/Module` +
     `CONTAINS_*`；probe 已证明可以生成。
  2. **callsite 列级精度**：cbm 边属性已有 `line`，但没有 `column`/`sites[]`；SCIP 有，写进去即可
     （cbm 现有 UI 暂时不读 `sites`，需要小改 `/api/trace` 或前端）。
  3. **内联回调归属**：SCIP 的 `enclosing_range` 指向箭头函数本身，probe 会落到 Module 节点
     （`src/hof.ts -> c`）。生产版需要“最近的外层具名函数”映射，或为箭头建合成节点再挂父边。
- **增量**：SCIP 目前是全量索引（gpen 3.9s），cbm 有 `file_hashes` + incremental；
  建议 SCIP 路径先全量，cbm 继续服务非 TS/Svelte 的增量。
- **许可**：cbm MIT、SCIP Apache-2.0，兼容。

#### 三条 fork 路线

| 路线 | 改动 | 工作量 | 风险 |
| --- | --- | --- | --- |
| **A. 外部 writer（推荐先做）** | 不改 cbm；SCIP → cbm schema SQLite；cbm 只当运行时 | 1-2 周原型 | schema 是内部契约，cbm 升级要跟着改 |
| **B. 轻 fork（推荐落地）** | fork cbm，加 `scip_import` CLI（C 读 JSONL 或内嵌最小 protobuf 解码）+ `scip` 模式 | 3-6 周 | 仍是 C，但只碰 1-2 个文件；上游 rebase 可控 |
| **C. 深 fork** | 在 `pass_definitions/pass_calls` 里接管 TS/Svelte，保留 cbm 所有 pass | 2-3 个月 | 与 162 语言 parser/incremental 深度耦合，上游 churn 大 |

**建议**：先用 A 验证 UI/编辑器/MCP 的产品形态；确认后再做 B，把 writer 收进 cbm 仓库，
变成 `index_repository --indexer=scip`。不要从 C 开始。

#### 对编辑器的意义

- cbm 已有 `/api/symbol`（含 `file_path/start_line/end_line`）、`/api/trace`、`/api/impact`，
  UI 的 Monaco 已支持 `revealLine`。
- 要给 VSCode / fresh 做跳转，最干净的是加一个 **`cbm-nav` LSP**：
  `textDocument/definition`、`textDocument/references`、`callHierarchy/incomingCalls` /
  `outgoingCalls`，读同一个 SQLite。SCIP 的 `file:line:column` + `enclosing_range` 正好是
  LSP 需要的字段；cbm 现有 `line` 属性只差 `column`。
- 如果 fresh 的 LSP 支持不完整，就同时提供一个 `cbm nav <file>:<line>:<col> --json` CLI；
  VSCode 扩展和 fresh 都走同一份查询。

### 7.6 SCIP vs cbm Hybrid LSP：硬 fixture 实测（2026-10 追加）

先纠正两个常见误解：

- **SCIP 不是“把官方 LSP 集中起来”**。SCIP 是批量索引格式（protobuf），索引器用的是
  **编译器/类型检查器 API**：`scip-typescript` 用 TypeScript compiler API，`scip-java` 用
  javac/ECJ，`scip-go` 用 `go/types`，rust-analyzer 用它自己的 HIR。它和 LSP 共享“语义来源”，
  但不是 LSP 协议，也不是交互式请求。
- **cbm 的 Hybrid LSP 也不是官方 LSP 实现**。README 自己写的是
  “lightweight C implementation ... No language server process”；它是在 C 里重新实现
  类型解析启发式，而不是启动 tsserver/pyright/gopls。TS 解析器本体是
  `internal/cbm/lsp/ts_lsp.c`，**6,168 行 C**。

所以真正的对比是：**编译器 API 的批量索引（SCIP） vs C 重实现的类型启发式（cbm）**。

具体到每个 `scip-*` 索引器，语义引擎如下（均**不**通过 LSP 协议）：

| 索引器 | 语义引擎 | 是否包装 LSP |
| --- | --- | --- |
| `scip-typescript` | TypeScript compiler API（`ts.createProgram` / `TypeChecker`） | 否；不启动 tsserver |
| `scip-go` | `golang.org/x/tools/go/packages` + `go/types` | 否；不启动 gopls |
| `scip-java` | javac 插件（`scip-javac`）；Scala/Kotlin 走 SemanticDB | 否；不启动 JDT LS |
| `scip-clang` | Clang 21 AST（`RecursiveASTVisitor` 等） | 否；不启动 clangd |
| `scip-python` | **Pyright 的 fork**，直接用 pyright 分析库 | 否；不是 pyright-langserver，但同引擎 |
| `scip-ruby` | **Sorbet** 类型检查器 | 否；不启动 Sorbet LSP |
| `rust-analyzer scip` | rust-analyzer 自己的 `ide::AnalysisHost` / `RootDatabase` | 否；与 LSP 同二进制，但直接调分析层 |

LSP 不适合做批量索引：它是光标/请求驱动的，没有“枚举全仓符号/occurrence”的 API；
SCIP 需要整程序、确定性、一次遍历。共享的是**语义引擎**，不是 LSP 协议。

#### 硬 fixture

`rules/cbm/dev/fixtures/callgraph-ts-hard`：8 个文件，专门覆盖 TS 类型系统 + Svelte TS：

| 构造 | 期望边 |
| --- | --- |
| path alias `@lib/*` + barrel re-export | `useAlias -> UserRepo`、`useAlias -> get` |
| 泛型 | `useGeneric -> identity` |
| 条件类型 `infer` | `useCond -> load` |
| 高阶函数 | `useHof -> apply`、`useHof -> helper` |
| overload | `useOverload -> pick` |
| 继承/抽象方法 | `get -> load`、`load -> make` |
| Svelte `<script lang="ts">` | `Comp.svelte -> UserRepo`、`go -> get`、`go -> helper` |

结果（12 条核心 GT）：

| 工具 | TP | FP | FN | 说明 |
| --- | ---: | ---: | ---: | --- |
| **cbm** | 9 | 1 | 3 | 漏 `useAlias -> UserRepo/get`（路径别名 + 重导出）、漏 `go -> get`（Svelte 脚本的类型推断）；`Comp.svelte -> go` 落到 module 节点 |
| **SCIP** | 11 | 2 | 1 | 漏 `useHof -> helper`（内联箭头归到 module）；`apply -> apply` 自环 FP；`name -> go` 是响应式语句的额外边 |

具体差异：

- **cbm 能做的**：泛型、条件类型、重载、HOF、继承、`this.load`（suffix_match 到
  `UserRepo.load`）、Svelte 里的 `go -> helper`。
- **cbm 漏的**：
  - `useAlias -> get`：`@lib/barrel` 的 `export *` + `export { UserRepo as RepoAlias }`，
    加上 `new RepoAlias().get()`。cbm 的 TS 启发式没有把“重导出别名 → 构造器 → 方法”串起来；
    只有 `useAlias -> User` 的 USAGE，没有 CALLS。
  - `go -> get`：Svelte 的 `<script lang="ts">` **确实**被识别为 TS（`apply_script_attribute`
    会看 `lang="ts"`），但 **TS 类型解析器没有在 embedded block 上运行**：
    `cbm_run_ts_lsp` 只在 `cbm.c` 的顶层文件路径调用，`parse_one_embedded_block` 只调
    `cbm_extract_unified`。所以 Svelte 脚本只有语法 + import map，没有 receiver 类型推断。
- **SCIP 漏的**：`useHof -> helper` 的内联箭头归到 `features.ts` module 节点（旧 derive 的
  归属问题，不是类型问题）；`apply -> apply` 是参数 `fn()` 被误解析成自调用。

#### 对“Svelte 基于 cbm 的 TypeScript”的直接影响

可以，但不是配置开关：

1. cbm 已经把 `<script lang="ts">` 解析为 TypeScript **grammar**；
2. 需要在 `parse_one_embedded_block` 之后补一次 `cbm_run_ts_lsp`（或 cross 版本），
   带上 embedded module 的 import map 和 cross registry；
3. 还要处理 `<script context="module">`、runes（`$state/$props/$derived`）和
   `svelte2tsx` 风格的 props 类型；
4. 做完之后你继承的是 cbm 的 TS 启发式，而不是 `tsc` 的完整语义。

#### 结论

- 如果产品只问“谁调用谁 / 改这个影响什么”，cbm 的 9/12 + 类型启发式已经够用；
  Svelte 补上 embedded TS resolver 后可以**不引 SCIP**，省掉 Node/Rust 依赖和 writer。
- 如果产品要给 VSCode/fresh 做**可信的 definition/references**，或者需要
  path alias/重导出/复杂泛型/条件类型/声明合并的边，**SCIP 仍然必要**；
  这些正是 cbm 6k 行 C 启发式最容易漏的地方。
- 折中方案：**SCIP 只接管 TS/Svelte，cbm 接管其余 160 语言**。这是“混合的混合”，
  既保留 cbm 的单二进制/多语言，又不在 TS/Svelte 上做语义妥协。

### 7.7 直接复用 `.scip` protobuf：实测可行（2026-10 追加）

结论：**可行，而且当前 derive 需要的字段全在官方 SCIP schema 里，不需要 sidecar。**

#### 字段核对

`scip-typescript` 的 `src/scip.ts`（`protoc-gen-ts` 生成，schema 来自官方 `scip.proto`）已经包含：

| 字段 | 位置 | 用途 |
| --- | --- | --- |
| `Occurrence.range` | field 1 | 定义/引用/call site 的精确位置 |
| `Occurrence.symbol` | field 2 | 符号身份 |
| `Occurrence.symbol_roles` | field 3 | Definition / Import / … |
| `Occurrence.syntax_kind` | field 5 | `IdentifierFunction=15`，derive 的调用过滤 |
| `Occurrence.enclosing_range` | field 7 | 调用归属到外层函数 |
| `SymbolInformation.display_name` | field 4 | fork 发的真实函数名 |
| `SymbolInformation.kind` / `enclosing_symbol` | field 5 / 8 | 节点类型/嵌套 |

所以当前 `scip-graph` derive 需要的东西 **全部是官方字段**，不是 fork 私有扩展。

#### 等价性实验

用 fork 产出的 `.scip` 直接 `Index.deserializeBinary`，再 `toObject()` 喂给旧 derive：

```text
fixture.scip → protobuf → derive  = 25 nodes / 28 edges
fixture.json → JSON     → derive  = 25 nodes / 28 edges
edge set 完全一致
```

gpen `src/`：163 docs / 40,488 occurrences，直接 protobuf 解析 123ms。

#### 体积与速度

| 产物 | 大小 | 解析 |
| --- | ---: | --- |
| `gpen.scip` | **4.6 MB** | `deserializeBinary` ≈ 123ms |
| `gpen.json`（`scip print --json`） | 8.9 MB | `scip print` 88ms + `JSON.parse` 47ms ≈ 135ms |

gpen 规模下速度基本打平，**主要收益是磁盘减半 + 去掉一个进程/中间文件**；大仓 protobuf 的解析和体积优势会更明显。

#### 实施建议

1. **`scip-graph`（TS）**：直接 `import { scip } from './scip-proto/scip'`，用
   `scip.Index.deserializeBinary(bytes)`；删掉 `scip:index:json`。把生成的 `scip.ts` 放到共享包，
   不要跨 submodule 引用。
2. **cbm writer（TS/Rust）**：用官方 bindings 读 `.scip`，直接写 cbm SQLite；cbm 不解析 protobuf。
3. **C 侧**：没有官方 C binding。若必须让 cbm 在进程内读 `.scip`，写一个最小 protobuf 解码器
   （varint + length-delimited，跳过未知字段，约 300–600 行），或 `protobuf-c` + 生成代码；
   否则维持“writer 读 `.scip` → SQLite”的进程边界。
4. **扩展字段**：官方 schema 以外的字段（例如 rune 分类、confidence、callsite 聚合）放 sidecar：
   `index.scip` + `index.gpen-ext.jsonl`（或 SQLite），key 用
   `(relative_path, symbol, range_start)`；sidecar 缺失时 derive 用默认值。
5. **注意**：`.scip` 是二进制，不可 git diff；需要 diff 的是派生 IR（`scip-graph.json`），
   不是 raw index。raw `.scip` 替换的是 `index-fork.json`，不是 `scip-graph.json`/`func.json`。

### 7.8 A0 writer 已实现（2026-10 追加）

`rules/cbm/tools/scip-cbm-writer/` 是 §7.5/§7.7 的生产化版本：TS+Bun 直接读二进制 `.scip`，
写 cbm schema v3 SQLite，**cbm 零 C 改动**；不再经过 `scip print --json`。

- 硬 fixture：7 docs → 48 nodes / 66 edges / 19 CALLS；`useAlias -> get/UserRepo`、
  `useHof -> helper` 都在。
- gpen-js：163 docs → 6254 nodes / 8634 edges / 2380 CALLS / 1716 Svelte nodes；
  `trace_path scheduleLive` 返回 6 个 callee。
- 关键修正：SCIP `local N` 必须按 `(relative_path, symbol)` 作用域，否则不同文件的
  `local 86` 会互相覆盖，Svelte 内部调用会全部掉到 Module 节点。
- 已知边界：只写 `CALLS` + 容器边；`end_line` 只是标识符范围；`enclosing_range`
  缺失时调用会挂到 Module。A0.5 再决定 SCIP 是否常驻。

---

## 8. 复现

```bash
cd rules/cbm/dev
./install.sh              # 只装 codebase-memory-mcp 0.12.1
./run-fixture.sh          # cbm + SCIP + SCIP→cbm 探针
./run-demo.sh             # A0 writer + cbm HTTP + B0 UI 端到端

# SCIP → cbm 兼容库（§7.5）
python3 scip-cbm-probe.py out/scip/fixture.json scip-probe fixtures/callgraph-ts
```

真实仓库口径：

```bash
# SCIP
node rules/scip-typescript/dist/src/main.js index --cwd . --output /tmp/gpen.scip
~/tools/scip/scip print --json /tmp/gpen.scip > /tmp/gpen.json
# 旧 derive 从 jj 历史取
jj -R rules/scip-graph file show -r deprecated-202609 scripts/derive-graph.ts > /tmp/derive.ts
# TSA
rules/peers/tsa/.venv/bin/python rules/peers/tsa/driver.py src /tmp/tsa.json
# cbm
rules/cbm-runtime/node_modules/.bin/codebase-memory-mcp cli --json index_repository \
  --repo-path src --name gpen-src --persistence false
```

---

## 9. 一句话总结

> **SCIP 索引器值得留，`scip-graph` 作为“产品”不值得再全自研。**
> 最省认知的路线：SCIP 只做索引，产 cbm schema 的 SQLite；cbm 负责 MCP/UI/查询/编辑器跳转；
> 自己的 `scip-graph` 只保留“可 diff 的 IR + 双面渲染”这类差异化。lspgraph-core 不进运行时。
