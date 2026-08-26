import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { loadEnv } from "vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { existsSync, readFileSync } from "node:fs";

export default defineConfig(({ mode }) => {
  const { allowedHost, httpsCert, httpsKey } = loadEnv(mode, process.cwd(), "");
  const https =
    httpsCert && httpsKey && existsSync(httpsCert) && existsSync(httpsKey)
      ? { cert: readFileSync(httpsCert), key: readFileSync(httpsKey) }
      : undefined;
  return {
    server: {
      ...(allowedHost ? { allowedHosts: [allowedHost] } : {}),
      ...(https ? { https } : {}),
    },
    plugins: [
      tailwindcss(),
      sveltekit({
        compilerOptions: {
          // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
          runes: ({ filename }) =>
            filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
          customElement: ({ filename }) => /[/\\]ce[/\\]/.test(filename),
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
