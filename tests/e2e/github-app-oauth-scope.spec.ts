import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth } from "./helpers/auth";

test("GitHub App reconnection requests identity scopes without broad repository OAuth access", async ({
  page,
}) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--port",
      String(port),
      "--hostname",
      "127.0.0.1",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLAYWRIGHT: "1",
        PLAYWRIGHT_AUTH_BYPASS_SECRET: "playwright-auth-bypass",
        GITHUB_APP_ID: "1",
        GITHUB_APP_NAME: "fixture-mogplex",
        GITHUB_APP_PRIVATE_KEY: "fixture-app-config",
        GITHUB_CLIENT_ID: "fixture-github-client",
        GITHUB_CLIENT_SECRET: "fixture-github-secret",
        BETTER_AUTH_SECRET: "playwright-better-auth-secret-at-least-32-chars",
        BETTER_AUTH_URL: base,
        NEXT_PUBLIC_APP_URL: base,
        DATABASE_URL: "",
        MOGPLEX_RUNTIME_DATABASE_URL: "",
        mogplex_DATABASE_URL: "",
        SENTRY_DSN: "",
        NEXT_PUBLIC_SENTRY_DSN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("Fixture app did not become ready")),
        15_000
      );
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Ready in")) {
          clearTimeout(deadline);
          resolve();
        }
      });
      child.once("error", (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(deadline);
        reject(new Error("Fixture app exited before readiness"));
      });
    });
    await enableScopedE2EAuth(page);
    let authorization: URL | undefined;
    await page.route(`${base}/api/auth/github?reauthorize=1`, async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      authorization = new URL(response.headers().location);
      return route.fulfill({
        contentType: "text/html",
        body: "<p>Authorization request captured</p>",
      });
    });
    await page.goto(`${base}/api/auth/github?reauthorize=1`);
    await expect(
      page.getByText("Authorization request captured")
    ).toBeVisible();
    const scopes = authorization?.searchParams.get("scope")?.split(/\s+/);
    expect(scopes).toContain("read:org");
    expect(scopes).not.toContain("repo");
    expect(scopes).not.toContain("public_repo");
    expect(authorization?.searchParams.get("redirect_uri")).toBe(
      `${base}/api/auth/github/callback`
    );
    let callback: URL | undefined;
    await page.route(
      `${base}/api/auth/github/callback?installation_id=98765`,
      async (route) => {
        const response = await route.fetch({ maxRedirects: 0 });
        callback = new URL(response.headers().location);
        return route.fulfill({
          contentType: "text/html",
          body: "<p>Installation callback captured</p>",
        });
      }
    );
    await page.goto(`${base}/api/auth/github/callback?installation_id=98765`);
    await expect(
      page.getByText("Installation callback captured")
    ).toBeVisible();
    // No state is required, but an installation that cannot be verified
    // against GitHub is never attached.
    expect(callback?.pathname).toBe("/settings/account");
    expect(callback?.searchParams.get("github")).toBe("error");
    expect(callback?.searchParams.get("reason")).toBe(
      "github_installation_fetch"
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
});
