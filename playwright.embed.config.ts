import { defineConfig } from "playwright/test";

/** embed 产物的 e2e：不需要 SvelteKit dev server，直接注入 dist/embed 的 IIFE。 */
export default defineConfig({
  testDir: "./tests/embed",
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: { trace: "on-first-retry", screenshot: "only-on-failure" },
});
