/**
 * embed 构建：把 src/embed 打成宿主可用的单文件库（ESM + IIFE）。
 *
 * 与 SvelteKit 的 `bun run build` 无关，单独跑：`bun run build:embed`。
 * 产物 dist/embed/：
 *   gpen-embed.js       ESM（给 WXT / userscript / vsix webview 等再打包）
 *   gpen-embed.iife.js  经典 script（可直接 <script> 注入 / Playwright 测试）
 * CSS 不单独产出：inlineCss 插件把构建出的 CSS 塞回 JS（shadow 注入只需要字符串）。
 */
import { readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const CSS_PLACEHOLDER = "__GPEN_EMBED_CSS__";

/** 把产出的 .css 资源改成 JS 里的字符串常量（src/embed/css.ts 的占位符）。
 *
 * 占位符在源码里是**字符串字面量**（`"…"`），但各 format 打的引号不同（ESM 是 `"`、IIFE 是 `` ` ``），
 * 所以必须连引号一起换成 JSON.stringify(css)；否则会得到 `""<css>""`（语法错）或 `` `"<css>"` ``
 * （语法通过但 CSS 首尾多出两个引号字符）——两种都在真实产物上踩过。
 */
function inlineCss(): Plugin {
  const quoted = /(['"`])__GPEN_EMBED_CSS__\1/g;
  return {
    name: "gpen-embed-inline-css",
    enforce: "post",
    generateBundle(_options, bundle) {
      let css = "";
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === "asset" && fileName.endsWith(".css")) {
          css += String(output.source);
          delete bundle[fileName];
        }
      }
      const literal = JSON.stringify(css);
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        if (!output.code.includes(CSS_PLACEHOLDER)) continue;
        output.code = output.code
          .replace(quoted, literal) // 连引号一起替换（常见形态）
          .replaceAll(CSS_PLACEHOLDER, literal); // 裸标识符位置的兜底
      }
    },
  };
}

export default defineConfig({
  logLevel: "warn",
  define: { __GPEN_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    tailwindcss(),
    svelte({
      compilerOptions: {
        // 与 vite.config.ts 的 sveltekit() 选项保持一致
        runes: ({ filename }) => (filename.includes("node_modules") ? undefined : true),
        customElement: ({ filename }) => filename.endsWith(".web.svelte"),
      },
    }),
    inlineCss(),
  ],
  build: {
    outDir: "dist/embed",
    emptyOutDir: true,
    // 单文件：资源内联成 data URI（favicon 之类），杜绝额外请求
    assetsInlineLimit: 1024 * 1024,
    cssCodeSplit: false,
    lib: {
      entry: "src/embed/index.ts",
      name: "GpenEmbed",
      formats: ["es", "iife"],
      fileName: (format) => (format === "es" ? "gpen-embed.js" : "gpen-embed.iife.js"),
    },
  },
});
