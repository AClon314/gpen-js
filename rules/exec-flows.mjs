#!/usr/bin/env node
/**
 * `exec-flows` —— 用 Jelly 静态分析产出 gpen-js 的「执行流」基线（调用图）。
 *
 * Jelly 是一个 JavaScript/TypeScript 调用图 + 库用法分析器（见 rules/jelly）。
 * 本项目以 git submodule 形式引入 AClon314/jelly fork，并在 fork 上补了
 * `.svelte` 的 `<script>` 支持，使 SvelteKit 路由/组件能进入调用图。
 *
 * 产出（写入 rules/exec-flows/）：
 *   - callgraph.json —— 机器可读的调用图（提交为基线，便于后续 diff）
 *   - callgraph.html —— 浏览器可视化（.gitignore 忽略，随时可重新生成）
 *
 * 用法：
 *   bun run exec-flows                # 分析 src，忽略外部依赖
 *   bun run exec-flows -- --warnings-unsupported   # 额外参数透传给 jelly
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const jellyMain = resolve(here, "jelly/lib/main.js");
const outDir = resolve(here, "exec-flows");

if (!existsSync(jellyMain)) {
  console.error(
    [
      "rules/jelly 尚未构建，请先执行：",
      "  git submodule update --init --recursive",
      "  cd rules/jelly && bun install && bun run build",
    ].join("\n"),
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const args = [
  jellyMain,
  "-b",
  root,
  "--ignore-dependencies",
  "--no-print-progress",
  ...process.argv.slice(2),
  "-j",
  resolve(outDir, "callgraph.json"),
  "-m",
  resolve(outDir, "callgraph.html"),
  resolve(root, "src"),
];

const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);
