# rules/depcruise —— 模块级依赖图

用 [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) 出**模块级**依赖图，
与 `rules/exec-flows/`（jelly 的**函数级**调用图）互补：这里回答「谁 import 了谁 / 改动会波及哪些模块」，
jelly 回答「谁调用了谁」。

## 命令

四种视图都是同一个 `rules/depcruise/graph.mjs`，每次输出 `out/<name>.{mmd,json,dot,svg}`：

```sh
bun run graph:deps                              # 全量（218 模块 / 490 边）
bun run graph:deps -- --no-svg                  # 跳过 dot/svg（全量 svg 约 2.6s）
bun run graph:deps:focus -- <regex> --depth 1   # 子图：focus 模块 ± N 跳
bun run graph:deps:overview                     # 目录级折叠总览（默认 -S '^src/[^/]+/'）
bun run graph:deps:affected                     # 相对 origin/main 的变更影响面
bun run graph:deps:affected -- --base main~4    # 自定义基线 ref
```

- `.mmd`（mermaid）适合进 PR / GitHub 渲染与 git diff；`.svg`（graphviz `dot`）适合本地放大看
  —— 浏览器直接打开，Ctrl/⌘ + 滚轮缩放。`.json` 是机器可读明细（数模块/边/unresolved）。
- `--no-svg` 用于没有 graphviz 的环境；`svg` 模式需要本机有 `dot`。

## 可读性：别直接看全量图

| 视图                               | 规模              | `.mmd` | `.svg` | 适合                                    |
| ---------------------------------- | ----------------- | ------ | ------ | --------------------------------------- |
| `deps`（全量）                     | 218 模块 / 490 边 | 56 KB  | 552 KB | 机器/工具；人眼约 **62 个屏幕**，看不动 |
| `overview`（目录级折叠）           | 51 / 58           | 9 KB   | 88 KB  | 先看整体分层                            |
| `focus <某模块> --depth 1`         | 6 / 9             | 2 KB   | 13 KB  | **日常读图就用这个**                    |
| `affected`（相对 `origin/main~4`） | 17 / 14           | 3 KB   | 28 KB  | PR 里贴图                               |

全量图无论 mermaid 还是 SVG 都只是「换了个容器」，节点多到 62 屏不是渲染器的问题；
可读性靠 `focus` / `overview` / `affected` 切子图，全量 svg 仅用于「需要时在地图里找位置」。

## 为什么 `minify: false`

depcruise 的 mermaid reporter 默认压缩节点名（节点 id 变成 `1W` 这类**位置序号**），
插一个模块就会让其后所有 id 重编号，整张 `.mmd` 无法 git diff。
`config.mjs` 里关掉：

```js
reporterOptions: {
  mermaid: {
    minify: false;
  }
}
```

之后节点 id 由模块路径派生（如 `src_lib_components_workspace_GpenWorkspace_svelte`），
新增模块只多两行、0 行改写 —— 实测消融 diff = `212a213 / 760a762`。

## 配置（`config.mjs`）

- `options.tsConfig.fileName = "tsconfig.json"`：让 `#lib/*`（package.json `imports`）与路径别名可解析。
- `doNotFollow: { path: "node_modules" }`：不深入 node_modules 内部（直接依赖作为叶子节点保留）。
- `exclude: { path: "(^|/)(tests|rules/jelly)/" }`：测试与第三方 submodule 不属于生产模块图。
- **注意**：dependency-cruiser 必须和 `typescript` / `svelte` 装在一起才能解析 `.ts`/`.svelte`
  （transpiler 从 depcruise 自身安装位置解析），所以它是仓库 devDependency，**不能用纯 `bunx`**。

## 产物

`out/` **未入库**（已 gitignore）：`.mmd` / `.json` / `.dot` / `.svg` 每次改动都会 churn，且 `affected`
依赖基线 ref 的当前状态，不适合当稳定基线。要看就现场 `bun run graph:deps[:<视图>]` 生成。
（对比：jelly 的 `exec-flows/callgraph.json` 是刻意提交的**函数级**基线，二者定位不同。）
