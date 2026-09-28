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
 * 产出（全部写入 `rules/out/`；**只有 func.json 与 func.log 提交为基线**，见 .gitignore）：
 *   func.json     机器可读调用图（提交，便于后续 diff）
 *   func.log      本次运行日志（提交，与 func.json 同一次运行对应）
 *   func.html     浏览器可视化（忽略，随时重新生成）—— **不内联数据**，运行时 fetch
 *                 `./func.json` 并现场构建图，所以它只是一份静态模板（~31KB，与仓库规模无关）
 *   func-vendor/  可视化的前端依赖（忽略，见下）
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

// func.json 里 jelly 写的 "time" 每次运行都变，会让提交为基线的 diff 永远有一行噪音。
// 基线只需要反映结构变化，所以删掉该行（CallGraph.time 是可选的）。
// 注意：只能做字符串替换，不能 JSON.parse + stringify —— jelly 自己的排版是
// 「1 空格缩进 + fun2fun/call2fun 每个数组压在一行」，重新序列化会把文件从 277KB 撑到 342KB。
const jsonText = readFileSync(jsonPath, "utf8");
const withoutTime = jsonText.replace(/^\s*"time": "[^"]*",\n/m, "");
if (withoutTime !== jsonText) writeFileSync(jsonPath, withoutTime);

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
