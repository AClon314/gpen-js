import { existsSync } from "node:fs";
import { chromium, defineConfig } from "playwright/test";

const protocol = process.env.httpsCert && process.env.httpsKey ? "https" : "http";
const hostA = `${protocol}://127.0.0.1:4173`;
const hostB = `${protocol}://127.0.0.1:4174`;
const executablePath = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  chromium.executablePath(),
  "/usr/bin/google-chrome",
  "/bin/google-chrome",
].find((path) => path && existsSync(path));

/**
 * embed 项目直接注入 `dist/embed` 的 IIFE，不需要网站 dev server。
 * `bun run test:embed` 会设 `GPEN_EMBED_ONLY=1` 跳过 webServer（embed 不依赖 SvelteKit）。
 */
const embedOnly = process.env.GPEN_EMBED_ONLY === "1";

export default defineConfig({
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "e2e",
      testDir: "./tests/e2e",
      testMatch: "**/*.e2e.ts",
      use: {
        baseURL: hostA,
        ignoreHTTPSErrors: protocol === "https",
      },
    },
    {
      name: "embed",
      testDir: "./tests/embed",
      testMatch: "**/*.e2e.ts",
    },
  ],
  webServer: embedOnly
    ? undefined
    : [
        {
          command: "bun run dev -- --port 4173",
          url: `${hostA}/`,
          ignoreHTTPSErrors: protocol === "https",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: "bun run dev -- --port 4174",
          url: `${hostB}/`,
          ignoreHTTPSErrors: protocol === "https",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
