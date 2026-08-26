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

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
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
    baseURL: hostA,
    ignoreHTTPSErrors: protocol === "https",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "bun run dev -- --port 4173",
      url: `${hostA}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "bun run dev -- --port 4174",
      url: `${hostB}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
