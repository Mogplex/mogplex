import { defineConfig, devices } from "@playwright/test";

const rootDir = process.cwd();
const port = Number(process.env.PLAYWRIGHT_PORT || 3000);
const baseURL = `http://localhost:${port}`;
const testServerEnv =
  `PLAYWRIGHT=1 PLAYWRIGHT_AUTH_BYPASS_SECRET=playwright-auth-bypass ` +
  `BETTER_AUTH_SECRET=playwright-better-auth-secret-at-least-32-chars ` +
  `BETTER_AUTH_URL=${baseURL} NEXT_PUBLIC_APP_URL=${baseURL}`;

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
    // BETTER_AUTH_URL pins better-auth's baseURL to the server under test:
    // without it a real NEXT_PUBLIC_APP_URL in .env.local makes better-auth
    // mint Secure cookies for the public https origin, which the browser
    // drops on http://localhost and every session-dependent flow fails.
    command: `${testServerEnv} pnpm --dir ${rootDir} build && ${testServerEnv} pnpm --dir ${rootDir} exec next start --port ${port}`,
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
