import { defineConfig, devices } from "@playwright/test";

const rootDir = process.cwd();
const port = Number(process.env.PLAYWRIGHT_PORT || 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `PLAYWRIGHT=1 PLAYWRIGHT_AUTH_BYPASS_SECRET=playwright-auth-bypass pnpm --dir ${rootDir} build && PLAYWRIGHT=1 PLAYWRIGHT_AUTH_BYPASS_SECRET=playwright-auth-bypass pnpm --dir ${rootDir} exec next start --port ${port}`,
    cwd: rootDir,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
