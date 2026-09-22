import { existsSync } from "node:fs";
import { chromium, defineConfig } from "playwright/test";
const executablePath = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  chromium.executablePath(),
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/context-menu.e2e.ts", "**/menus.e2e.ts"],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "https://127.0.0.1:5173",
    ignoreHTTPSErrors: true,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
});
