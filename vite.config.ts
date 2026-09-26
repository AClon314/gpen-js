import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { loadEnv } from "vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { existsSync, readFileSync } from "node:fs";
import { gpenDefine, gpenSvelteCompilerOptions } from "./vite.embed.config.ts";

export default defineConfig(({ mode }) => {
  const { allowedHost, httpsCert, httpsKey } = loadEnv(mode, process.cwd(), "");
  const https =
    httpsCert && httpsKey && existsSync(httpsCert) && existsSync(httpsKey)
      ? { cert: readFileSync(httpsCert), key: readFileSync(httpsKey) }
      : undefined;
  return {
    define: { ...gpenDefine },
    server: {
      ...(allowedHost ? { allowedHosts: [allowedHost] } : {}),
      ...(https ? { https } : {}),
    },
    plugins: [
      tailwindcss(),
      sveltekit({
        compilerOptions: {
          // runes / customElement 与 embed 构建共用一份定义（见 vite.embed.config.ts）。
          ...gpenSvelteCompilerOptions,
          experimental: { async: true },
        },

        adapter: adapter({
          pages: "build",
          assets: "build",
          fallback: "index.html",
        }),
        experimental: { remoteFunctions: true },
      }),

      paraglideVitePlugin({
        project: "./project.inlang",
        outdir: "./src/lib/paraglide",
        emitTsDeclarations: true,
      }),
    ],
  };
});
