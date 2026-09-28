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
 *   - vendor/        —— 可视化的前端依赖（见下，.gitignore 忽略）
 *
 * Jelly 自带的 visualizer.html 从 cdn.jsdelivr.net 加载 cytoscape 等 8 个库。
 * 浏览器打不开 jsdelivr（离线 / 国内网络 / 走 Tailscale MagicDNS 的客户端）时
 * 页面会全白，因为 cytoscape 没加载、DOMContentLoaded 回调直接抛错。这里在
 * 生成后把 CDN 资源镜像到 vendor/ 并把 URL 改成相对路径，使可视化只需能访问
 * 本机 http server 即可渲染（首次生成需要本机有网，之后有缓存就离线可用）。
 *
 * 用法：
 *   bun run exec-flows                # 分析 src，忽略外部依赖
 *   bun run exec-flows -- --warnings-unsupported   # 额外参数透传给 jelly
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const jellyMain = resolve(here, "jelly/lib/main.js");
const outDir = resolve(here, "exec-flows");
const htmlPath = resolve(outDir, "callgraph.html");
const vendorDir = resolve(outDir, "vendor");

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
  htmlPath,
  resolve(root, "src"),
];

const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: root });
if (result.status !== 0) process.exit(result.status ?? 1);

/**
 * 把可视化 HTML 里的 jsdelivr 资源下载到 vendor/ 并改成相对路径，使页面不再依赖外网。
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
    console.error(`[exec-flows] 无法本地化 ${url}: ${e instanceof Error ? e.message : e}`);
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
    html = html.split(url).join(`./vendor/${rel}`);
    localized++;
  }
  if (localized > 0) {
    writeFileSync(htmlPath, html);
    console.error(`[exec-flows] 已本地化 ${localized}/${urls.length} 个可视化依赖到 ${vendorDir}`);
  } else if (urls.length > 0) {
    console.error(`[exec-flows] 警告：${urls.length} 个可视化依赖未能本地化，页面可能仍依赖外网`);
  }
}

await localizeCdnAssets();
