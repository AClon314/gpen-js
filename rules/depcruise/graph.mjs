#!/usr/bin/env bun
/**
 * rules/depcruise/graph.mjs —— 统一出口，避免 package.json 里堆一长串命令行。
 *
 * 用法（等价于 `bun run graph:deps[:<mode>]`）：
 *
 *   bun rules/depcruise/graph.mjs deps                    全量：mmd + json + svg
 *   bun rules/depcruise/graph.mjs focus <regex> [--depth] 子图：focus ± N 跳（默认 1）
 *   bun rules/depcruise/graph.mjs overview [--collapse]   目录级总览（默认折叠到 src/<dir>/）
 *   bun rules/depcruise/graph.mjs affected [--base <ref>] 变更影响面（默认 origin/main）
 *
 * 通用 flag：`--no-svg` 跳过 dot/svg（全量图 svg 要 ~2.6s）。
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
const OUT = join(ROOT, "rules/depcruise/out");
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

/** 各模式：sources 是传给 depcruise 的路径，extra 是额外 flag。 */
function plan({ mode, positional, flags }) {
  const depth = flags.depth ?? "1";
  switch (mode) {
    case "deps":
      return { name: "deps", sources: ["src"], extra: [] };
    case "focus": {
      const focus = positional[0];
      if (!focus) throw new Error("用法：graph.mjs focus <regex> [--depth 1]");
      return { name: "focus", sources: ["src"], extra: ["-F", focus, "--focus-depth", depth] };
    }
    case "overview":
      return {
        name: "overview",
        sources: ["src"],
        extra: ["-S", flags.collapse ?? "^src/[^/]+/"],
      };
    case "affected":
      return {
        name: "affected",
        sources: ["src", "scripts", "rules"],
        extra: ["--affected", flags.base ?? "origin/main"],
      };
    default:
      throw new Error(`未知模式 ${mode}（可选：deps / focus / overview / affected）`);
  }
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
console.log(`depcruise ${options.mode} → ${summary ?? "(no json)"}`);
for (const file of written) {
  const { size } = statSync(file);
  console.log(`  ${file.replace(`${ROOT}/`, "")}  ${(size / 1024).toFixed(1)} KB`);
}
