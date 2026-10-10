import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { expect, test } from "@playwright/test";

// Normal e2e pages intentionally bypass consent. Exercise the same production
// build with that bypass disabled, using the built-in offline policy (no keys).
test("public consent loads styled controls and saves customized preferences", async ({
  page,
}) => {
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, "127.0.0.1", resolve)
  );
  const address = reservation.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(address.port),
    ],
    {
      env: {
        ...process.env,
        PLAYWRIGHT: "",
        NEXT_PUBLIC_C15T_URL: "",
        SENTRY_DSN: "",
        NEXT_PUBLIC_SENTRY_DSN: "",
        NODE_ENV: "production",
        MOGPLEX_DATA_BACKEND: "neon",
        NEXT_PUBLIC_MOGPLEX_DATA_BACKEND: "neon",
        BETTER_AUTH_SECRET: "playwright-better-auth-secret-at-least-32-chars",
        BETTER_AUTH_URL: `http://127.0.0.1:${address.port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Consent test server did not start")),
        15000
      );
      server.once("error", reject);
      server.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("Consent test server exited"));
      });
      server.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Ready")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const customize = page.getByRole("button", { name: /customize/i });
    await expect(customize).toBeVisible();
    // The UI and its stylesheet arrive together, rather than flashing native
    // controls while a deferred stylesheet is still loading.
    expect(
      await customize.evaluate(
        (element) => getComputedStyle(element).borderRadius
      )
    ).not.toBe("0px");
    await customize.click();
    await expect(page.getByRole("dialog")).toContainText(/necessary/i);
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("landing-primary-cta")).toBeVisible();
    await page.reload();
    await expect(customize).toHaveCount(0);
  } finally {
    server.kill();
  }
});
