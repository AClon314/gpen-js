/**
 * dependency-cruiser —— 模块级依赖图（与 `rules/exec-flows/` 的函数级调用图互补）。
 *
 * 关键点：`reporterOptions.mermaid.minify = false`。
 * depcruise 默认对节点名做压缩（节点 id 变成 `1W` 这类位置序号），插一个模块就会
 * 让后面所有 id 重编号，整张 `.mmd` 无法 git diff。关掉后节点 id 由模块路径派生
 * （`src_lib_components_workspace_GpenWorkspace_svelte`），新增模块只多两行。
 * 详见 `rules/depcruise/README.md`。
 */
export default {
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    // 不深入 node_modules 内部（直接依赖仍作为叶子节点出现）。
    doNotFollow: { path: "node_modules" },
    // 测试与第三方 submodule 不属于生产模块图。
    exclude: { path: "(^|/)(tests|rules/jelly)/" },
    reporterOptions: {
      mermaid: { minify: false },
    },
  },
};
