import { build } from "esbuild";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

let fixtureBundle: Promise<string> | undefined;
function bundle() {
  fixtureBundle ??= build({
    absWorkingDir: process.cwd(),
    entryPoints: [resolve("tests/e2e/fixtures/status-toast-showcase.tsx")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  }).then((result) => result.outputFiles[0].text);
  return fixtureBundle;
}

function attribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

/** Real toast components + the running production build's CSS, without adding
 * a test route or showcase to the shipped application. */
export async function loadStatusToastFixture(
  page: Page,
  theme: "light" | "dark"
) {
  await page.goto("/login");
  const styles = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).href)
    );
  if (styles.length === 0)
    throw new Error("The production stylesheet did not load.");
  const bodyClass = (await page.locator("body").getAttribute("class")) ?? "";
  const script = await bundle();
  await page.route("**/__e2e/status-toasts.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: script })
  );
  await page.route("**/__e2e/status-toasts", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html class="${theme}" style="color-scheme:${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles.map((href) => `<link rel="stylesheet" href="${attribute(href)}">`).join("")}</head><body class="${attribute(bodyClass)}"><div id="toast-fixture"></div><script defer src="/__e2e/status-toasts.js"></script></body></html>`,
    })
  );
  await page.goto("/__e2e/status-toasts");
  await page
    .getByRole("button", { name: "Show statuses", exact: true })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
}
