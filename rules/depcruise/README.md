# rules/depcruise —— 模块级依赖图

用 [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) 出**模块级**依赖图，
与 `rules/exec-flows/`（jelly 的**函数级**调用图）互补：这里回答「谁 import 了谁 / 改动会波及哪些模块」，
jelly 回答「谁调用了谁」。

## 命令

```sh
bun run graph:deps            # src 全量模块依赖图 → out/deps.mmd + out/deps.json（218 模块 / ~490 边）
bun run graph:deps:affected   # 相对 origin/main 的变更影响面 → out/affected.mmd（src + scripts + rules）
```

- `deps.json` 是机器可读的模块/依赖明细，用来数模块数、边数、unresolved。
- `affected` 是 `--affected origin/main`：只含变更模块 + 能到达它们的模块，贴在 PR / review 里最直观。

## 为什么 `minify: false`

depcruise 的 mermaid reporter 默认压缩节点名（节点 id 变成 `1W` 这类**位置序号**），
插一个模块就会让其后所有 id 重编号，整张 `.mmd` 无法 git diff。
`config.mjs` 里关掉：

```js
reporterOptions: { mermaid: { minify: false } }
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

`out/` **未入库**（已 gitignore）：`.mmd` / `.json` 每次改动都会 churn，且 `affected.mmd`
依赖 `origin/main` 的当前状态，不适合当稳定基线。要看就现场 `bun run graph:deps` 生成。
（对比：jelly 的 `exec-flows/callgraph.json` 是刻意提交的**函数级**基线，二者定位不同。）
