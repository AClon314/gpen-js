/**
 * ESLint (hybrid 第二轨) 配置
 *
 * 仅用于 oxlint 无法覆盖的 TypeScript **类型感知**规则（type-aware）：
 *  - catch/no-void-catch-return —— 阻止 Promise.catch() 回调返回 void/undefined。
 *
 * 流程分工（双轨并行）：
 *  - oxlint：跑 AST 级规则，极速（含 catch 块必须 return/throw）。
 *  - ESLint：只跑本项目需要类型的少数规则，作为 CI/CD 安全闸口。
 */
import tsParser from "@typescript-eslint/parser";
import rule from "./rules/no-void-catch-return.mjs";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.svelte-kit/**",
      "**/build/**",
      "**/dist/**",
      "**/.output/**",
      "**/src/lib/paraglide/**",
      "**/*.svelte", // Svelte 文件由 svelte-check 负责，@typescript-eslint 无法解析
      "**/*.css",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      catch: {
        rules: {
          "no-void-catch-return": rule,
        },
      },
    },
    rules: {
      "catch/no-void-catch-return": "error",
    },
    // 关闭可能与本项目冲突的默认规则，保持只做类型感知目标
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
];
