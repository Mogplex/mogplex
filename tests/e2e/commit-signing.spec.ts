import { test, expect, fulfillJson } from "./helpers/run-checks-fixtures";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";

const endpoint = "**/api/settings/commit-signing";
const empty = {
  available: true,
  configured: false,
  publicKey: null,
  fingerprint: null,
  title: null,
  registered: false,
  registeredAt: null,
  githubKeyId: null,
  createdAt: null,
};

test.beforeEach(async ({ page }) => {
  await enableScopedE2EAuth(page);
});

test("unavailable signing never offers key creation", async ({ page }) => {
  await page.route(endpoint, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ...empty, available: false }),
    })
  );
  await page.goto(scopedPath("settings/commit-signing"));
  await expect(
    page.getByText("Commit signing is not configured on this deployment.", {
      exact: false,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate a signing key" })
  ).toHaveCount(0);
});

test("a user creates a key, receives manual-registration guidance, and removes it", async ({
  page,
}) => {
  let configured = false;
  await page.route(endpoint, async (route) => {
    const request = route.request();
    if (request.method() === "DELETE") configured = false;
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { action: string };
      if (body.action === "register") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Add the public key to GitHub.",
            manualRegistrationRequired: true,
          }),
        });
        return;
      }
      expect(body.action).toBe("generate");
      configured = true;
    }
    await fulfillJson(
      route,
      configured
        ? {
            ...empty,
            configured: true,
            publicKey: "ssh-ed25519 public-test-key",
            fingerprint: "SHA256:public-test-fingerprint",
            createdAt: "2026-11-17T00:00:00Z",
          }
        : empty
    );
  });
  await page.goto(scopedPath("settings/commit-signing"));
  await page.getByRole("button", { name: "Generate a signing key" }).click();
  await expect(
    page.getByText("Signing key ready", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("ssh-ed25519 public-test-key", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Register with GitHub" }).click();
  await expect(
    page.getByText("Add the public key to GitHub.", { exact: false }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Add this key on GitHub" })
  ).toHaveAttribute("href", "https://github.com/settings/ssh/new");
  await page
    .getByRole("button", { name: "Remove stored key", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Generate a signing key" })
  ).toBeVisible();
  await expect(
    page.getByText("ssh-ed25519 public-test-key", { exact: true })
  ).toHaveCount(0);
});
