#!/usr/bin/env bun
/**
 * rules/depcruise/graph.mjs —— 统一出口，避免 package.json 里堆一长串命令行。
 *
 * 产物一律写到 `rules/out/`（与 `rules/graph-func.mjs` 的函数级调用图共用一个目录）：
 *
 *   bun run graph:module:deps                    全量：module.{json,mmd,dot,svg}
 *   bun run graph:module:focus -- <regex> [--depth]  子图：module-focus-<slug>.*
 *   bun run graph:module:overview [--collapse]   目录级总览：module-overview-<slug>.*
 *   bun run graph:module:affected [--base <ref>] 变更影响面：module-affected-<slug>.*
 *
 * 等价于 `bun rules/depcruise/graph.mjs <mode>`；通用 flag：`--no-svg` 跳过 dot/svg（全量 svg 要 ~2.6s）。
 *
 * **只提交全量视图的 `module.json` 与 `module.dot`**（见 .gitignore）；其余（`module.mmd`、
 * `module.svg`、以及全部 `module-*` 子图视图）都是 churn，现场生成。
 *
 * 为什么要有 `focus` / `overview`：全量图（218 模块 / 490 边）无论 mmd 还是 svg 都是
 * 几十个屏幕的量级，人眼读不了；SVG 只解决「能缩放查看」，可读性靠切子图。
 *
 * `.mmd` 与 `.svg` 是同一张图的两种渲染（mermaid vs graphviz dot）；`.svg` 需要
 * 本机有 graphviz 的 `dot`（也可直接 `--no-svg`）。
 */
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = join(ROOT, "rules/out");
const CONFIG = join(ROOT, "rules/depcruise/config.mjs");
const DEPCRUISE = join(ROOT, "node_modules/.bin/depcruise");

/** 解析成 { mode, positional, flags }，flag 形如 `--depth 2` / `--base origin/main`。 */
function parseArgs(argv) {
  const [mode = "deps", ...rest] = argv;
  const positional = [];
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token.startsWith("--")) {
      flags[token.slice(2)] = rest[index + 1];
      index += 1;
    } else {
      positional.push(token);
    }
  }
  return { mode, positional, flags };
}

/** 跑一次 depcruise；失败就把 stderr 原样抛出。 */
function depcruise(args) {
  const proc = Bun.spawnSync([DEPCRUISE, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr);
    throw new Error(`depcruise ${args.join(" ")} failed (${proc.exitCode})\n${stderr}`);
  }
}

/** 生成一种 reporter 的输出文件。 */
function emit(name, type, sources, extra = []) {
  const extension = { mermaid: "mmd", json: "json", dot: "dot" }[type];
  const file = join(OUT, `${name}.${extension}`);
  depcruise([...sources, "-c", CONFIG, "-T", type, "-f", file, ...extra]);
  return file;
}

/** dot → svg（需要 graphviz）。 */
function dotToSvg(dotFile, svgFile) {
  const proc = Bun.spawnSync(["dot", "-Tsvg", dotFile, "-o", svgFile], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error("`dot` 不可用或执行失败（装 graphviz 后重试）");
  }
  return svgFile;
}

/** 从 json 产物里数模块/边；没有 json 时返回 null。 */
function summarize(jsonFile) {
  try {
    const graph = JSON.parse(readFileSync(jsonFile, "utf8"));
    const edges = graph.modules.reduce(
      (total, module) => total + (module.dependencies?.length ?? 0),
      0,
    );
    return `modules=${graph.modules.length} edges=${edges}`;
  } catch {
    return null;
  }
}

/** 把任意字符串（focus 的 regex、overview 的折叠前缀、affected 的 base ref）压成文件名安全的 slug。 */
function slug(s) {
  const t = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return t || "all";
}

/** 各模式：name 是产物文件名前缀（全量视图是 `module`，其余都带 `module-` 前缀）。 */
const MODES = {
  deps: () => ({ name: "module", sources: ["src"], extra: [] }),
  focus: ({ focus, depth }) => ({
    name: `module-focus-${slug(focus)}`,
    sources: ["src"],
    extra: ["-F", focus, "--focus-depth", depth],
  }),
  overview: ({ collapse }) => ({
    name: `module-overview-${slug(collapse)}`,
    sources: ["src"],
    extra: ["-S", collapse],
  }),
  affected: ({ base }) => ({
    name: `module-affected-${slug(base)}`,
    sources: ["src", "scripts", "rules"],
    extra: ["--affected", base],
  }),
};

function plan({ mode, positional, flags }) {
  if (!(mode in MODES))
    throw new Error(`未知模式 ${mode}（可选：${Object.keys(MODES).join(" / ")}）`);
  const focus = positional[0];
  if (mode === "focus" && !focus) throw new Error("用法：graph.mjs focus <regex> [--depth 1]");
  return MODES[mode]({
    focus,
    depth: flags.depth ?? "1",
    collapse: flags.collapse ?? "^src/[^/]+/",
    base: flags.base ?? "origin/main",
  });
}

const options = parseArgs(process.argv.slice(2));
const { name, sources, extra } = plan(options);
mkdirSync(OUT, { recursive: true });

const written = [emit(name, "json", sources, extra), emit(name, "mermaid", sources, extra)];
if (options.flags["no-svg"] !== undefined && options.flags["no-svg"] !== "false") {
  console.log("（--no-svg：跳过 dot/svg）");
} else {
  const dotFile = emit(name, "dot", sources, extra);
  written.push(dotToSvg(dotFile, join(OUT, `${name}.svg`)));
}

const summary = summarize(join(OUT, `${name}.json`));
console.log(`depcruise ${options.mode} → ${name}  ${summary ?? "(no json)"}`);
for (const file of written) {
  const { size } = statSync(file);
  console.log(`  ${file.replace(`${ROOT}/`, "")}  ${(size / 1024).toFixed(1)} KB`);
}
