#!/usr/bin/env node
/**
 * `graph:func` —— 用 Jelly 静态分析产出 gpen-js 的**函数级**调用图基线。
 *
 * Jelly 是一个 JavaScript/TypeScript 调用图 + 库用法分析器（见 `rules/jelly/`，git submodule，
 * 本项目固定到 `AClon314/jelly` fork；fork 上补了 `.svelte` 的 `<script>` 支持与 Svelte rune 处理）。
 *
 * 用法：
 *   bun run graph:func:call                            # 分析 src，忽略外部依赖
 *   bun run graph:func:call -- --warnings-unsupported  # 额外参数透传给 jelly
 *
 * 产出（全部写入 `rules/out/`；**func.json / func-calls.json / func-boundaries.json / func.log
 * 提交为基线**，见 .gitignore）：
 *   func.json       调用图：模块、函数、边（可视化 / 影响面查询）—— 提交
 *   func-calls.json 调用点索引：调用点位置与 call→function 边（漏洞调用栈 / 可达性 /
 *                   未解析边界）—— 提交；其中的函数下标指 `func.json` 的索引空间
 *   func-boundaries.json  未解析调用点的离线分类（A/B/C1/C2/D/I/U/9，见
 *                   `graph-func-classify.mjs`）—— 提交；位置 id 索引，源码增删会让它 churn
 *   func.log        本次运行日志（提交，与上面几份同一次运行对应）
 *   func.html       浏览器可视化（忽略，随时重新生成）—— **不内联数据**，运行时 fetch
 *                 `./func.json` 并现场构建图，所以它只是一份静态模板（~31KB，与仓库规模无关）
 *   func-vendor/    可视化的前端依赖（忽略，见下）
 *
 * Jelly 自带的 visualizer.html 从 cdn.jsdelivr.net 加载 cytoscape 等库。浏览器打不开
 * jsdelivr（离线 / 国内网络 / 走 Tailscale MagicDNS 的客户端）时页面会全白，因为 cytoscape
 * 没加载、DOMContentLoaded 回调直接抛错。这里在生成后把 CDN 资源镜像到 func-vendor/ 并把
 * URL 改成相对路径，使可视化只需能访问本机 http server 即可渲染（首次生成需要本机有网，
 * 之后有缓存就离线可用）。用浏览器打开时记得强刷（Ctrl/Cmd+Shift+R），避免旧 HTML 被缓存。
 *
 * 等价的默认命令（见 `--help`）：
 *   jelly -b . --ignore-dependencies --no-print-progress \
 *         -j rules/out/func.json -m rules/out/func.html src
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const jellyMain = resolve(here, "jelly/lib/main.js");
const outDir = resolve(here, "out");
const jsonPath = resolve(outDir, "func.json");
const logPath = resolve(outDir, "func.log");
const htmlPath = resolve(outDir, "func.html");
const vendorDir = resolve(outDir, "func-vendor");

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
  jsonPath,
  // func.html 不内联数据，而是运行时 fetch ./func.json（jelly 的 --callgraph-html-data）。
  // 这样 HTML 只是一份静态模板，体积与仓库规模无关，且能直接看已提交的基线。
  "--callgraph-html-data",
  "./func.json",
  "-m",
  htmlPath,
  resolve(root, "src"),
];

// 捕获子进程输出：既打到终端（原样），也写 func.log（提交为基线，必须与 func.json 同一次运行对应）。
// func.log 里要去掉/归一化与本次运行环境相关、每次都会变的内容，否则基线每次重生成都churn：
//   - 绝对路径（仓库位置）→ 相对路径
//   - `Analysis time:` / `memory usage:` 一行（计时与内存）
// 终端输出保持原样，信息不丢。
const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);
writeFileSync(
  logPath,
  output
    .split("\n")
    .filter((line) => !line.startsWith("Analysis time: "))
    .map((line) => line.split(root).join("."))
    .join("\n"),
);
if (result.status !== 0) process.exit(result.status ?? 1);

// jelly 写出的是一份「什么都有」的调用图。这里把它拆成两个文件，并统一排版。
//
// 为什么要拆（实测当前文件 319KB）：`calls`(44.1%) + `call2fun`(11.7%) 共 55.8%，
// 而可视化和「函数影响面」查询**两者都不用** —— 它们只服务调用点级分析（漏洞调用栈、
// 可达性、未解析边界）。拆开后常见的图查询只读三分之一的体积，每个文件也各有明确用途。
//
// 为什么用 oxfmt 而不是 JSON.stringify(x, null, 1)：后者会把 `[3, 1]` 展开成 6 行；
// oxfmt 是「每个元素一行、短数组保持内联」，既有逐行 diff 粒度又不至于爆炸。
// 对照：jelly 原排版把 2562 条边压在**一行 37KB** 里，改一条边就重写整行。
const full = JSON.parse(readFileSync(jsonPath, "utf8"));
const callsPath = resolve(outDir, "func-calls.json");
// jelly 的 "time" 每次运行都变，会让基线的 diff 永远有一行噪音 → 两个文件都不要它。
const graph = {};
for (const [key, value] of Object.entries(full))
  if (key !== "time" && key !== "calls" && key !== "call2fun") graph[key] = value;
const calls = { graph: "func.json", files: full.files, calls: full.calls, call2fun: full.call2fun };
writeFileSync(jsonPath, `${JSON.stringify(graph, null, 2)}\n`);
writeFileSync(callsPath, `${JSON.stringify(calls, null, 2)}\n`);

// 统一排版（oxfmt 是仓库已有的 devDependency；失败不影响产物可用性，只是排版不同）
// `rules/out` 在 .prettierignore 里（不想让 `bun run format` 爬生成物），所以这里显式绕过它。
const oxfmt = resolve(root, "node_modules/.bin/oxfmt");
if (existsSync(oxfmt)) {
  const ignore = existsSync("/dev/null") ? ["--ignore-path=/dev/null"] : [];
  const fmt = spawnSync(oxfmt, [...ignore, "--write", jsonPath, callsPath], {
    cwd: root,
    encoding: "utf8",
  });
  if (fmt.status !== 0)
    console.error(`[graph:func] oxfmt 排版失败（产物仍可用）: ${(fmt.stderr ?? "").trim()}`);
}

appendFileSync(logPath, `[graph:func] 已拆分 → func.json（图）+ func-calls.json（调用点）\n`);

// 拆分产物排版之后，链式跑一次「未解析调用点分类」（S3d）：把匿名的未解析边界
// （`calls` 减去 `call2fun`，当前 2185 个）经官方 TS checker 归成 A/B/C1/C2/D/I/U/9，
// 产出可行动的清单 `func-boundaries.json`（提交为基线；类别含义见 `graph-func-classify.mjs`）。
// 失败必须优雅：分类器依赖仓库自带的 typescript 与 tsconfig，缺一即可能失败；但
// func.json / func-calls.json 已经写好，附加产物不该拖垮整个命令——记警告、保留旧文件。
const classifyScript = resolve(here, "graph-func-classify.mjs");
const boundariesPath = resolve(outDir, "func-boundaries.json");
const previousBoundaries = existsSync(boundariesPath) ? readFileSync(boundariesPath) : null;
const classify = spawnSync(process.execPath, [classifyScript], { cwd: root, encoding: "utf8" });
if (classify.status !== 0) {
  // 分类器只在成功路径写文件；失败时把可能被写坏的旧基线还原，确保「保留旧文件」。
  if (previousBoundaries) writeFileSync(boundariesPath, previousBoundaries);
  const detail = `${classify.stderr ?? ""}${classify.stdout ?? ""}`
    .trim()
    .split("\n")
    .slice(-3)
    .join("\n");
  console.error(
    `[graph:func] 警告：调用点分类失败，保留旧的 ${relative(root, boundariesPath)}（func.json / func-calls.json 不受影响）`,
  );
  if (detail) console.error(detail);
  appendFileSync(logPath, "[graph:func] 警告：调用点分类失败，func-boundaries.json 保持旧版本\n");
} else {
  // 用与 func.json / func-calls.json 相同的 oxfmt 口径排版（规则同下：绕过 .prettierignore）。
  if (existsSync(oxfmt)) {
    const ignore = existsSync("/dev/null") ? ["--ignore-path=/dev/null"] : [];
    const fmtBoundaries = spawnSync(oxfmt, [...ignore, "--write", boundariesPath], {
      cwd: root,
      encoding: "utf8",
    });
    if (fmtBoundaries.status !== 0)
      console.error(
        `[graph:func] oxfmt 排版失败（产物仍可用）: ${(fmtBoundaries.stderr ?? "").trim()}`,
      );
  }
  // 类别分布写进日志：基线 diff 时能看出「哪些边界类别变多了」（C2 变多尤其要警觉）。
  const counts = {};
  for (const [, kind] of JSON.parse(readFileSync(boundariesPath, "utf8")).kinds)
    counts[kind] = (counts[kind] ?? 0) + 1;
  const summary = ["A", "B", "C1", "C2", "D", "I", "U", "9"]
    .filter((kind) => counts[kind])
    .map((kind) => `${kind}=${counts[kind]}`)
    .join(" ");
  appendFileSync(logPath, `[graph:func] 未解析分类 → func-boundaries.json（${summary}）\n`);
}

/**
 * 把可视化 HTML 里的 jsdelivr 资源下载到 func-vendor/ 并改成相对路径，使页面不再依赖外网。
 * 已存在的资源不重复下载；下载失败只告警（保留 CDN URL），不影响调用图生成。
 */
const CDN_PREFIX = "https://cdn.jsdelivr.net/npm/";
const cdnUrlRegex = /https:\/\/cdn\.jsdelivr\.net\/npm\/[A-Za-z0-9@._+~/-]+/g;

async function fetchTo(url, dest) {
  if (existsSync(dest)) return true;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch (e) {
    console.error(`[graph:func] 无法本地化 ${url}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

async function localizeCdnAssets() {
  let html = readFileSync(htmlPath, "utf8");
  const urls = [...new Set(html.match(cdnUrlRegex) ?? [])];
  let localized = 0;
  for (const url of urls) {
    const rel = url.slice(CDN_PREFIX.length);
    const dest = resolve(vendorDir, rel);
    if (!(await fetchTo(url, dest))) continue;
    if (rel.endsWith(".css")) {
      // CSS 里的 url(...)（如 Font Awesome 字体）也一并镜像，保持相对路径结构
      const css = readFileSync(dest, "utf8");
      for (const m of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
        const ref = m[2];
        if (/^(data:|\/\/|https?:)/.test(ref)) continue;
        const abs = new URL(ref, url).href.split("?")[0];
        if (!abs.startsWith(CDN_PREFIX)) continue;
        await fetchTo(abs, resolve(vendorDir, abs.slice(CDN_PREFIX.length)));
      }
    }
    html = html.split(url).join(`./func-vendor/${rel}`);
    localized++;
  }
  if (localized > 0) {
    writeFileSync(htmlPath, html);
    console.error(`[graph:func] 已本地化 ${localized}/${urls.length} 个可视化依赖到 ${vendorDir}`);
  } else if (urls.length > 0) {
    console.error(`[graph:func] 警告：${urls.length} 个可视化依赖未能本地化，页面可能仍依赖外网`);
  }
}

await localizeCdnAssets();
