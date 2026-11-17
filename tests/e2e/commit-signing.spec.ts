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

test("refresh recognizes manual GitHub registration and distinguishes removal from a failed check", async ({
  page,
}) => {
  let registrationStatus = "not_registered";
  let registered = false;
  const publicKey = "ssh-ed25519 manually-registered-key";
  await page.route(endpoint, async (route) => {
    // Refresh must check status, never create, replace or re-register a key.
    expect(route.request().method()).toBe("GET");
    await fulfillJson(route, {
      ...empty,
      configured: true,
      publicKey,
      fingerprint: "SHA256:manual",
      registered,
      registrationStatus,
    });
  });
  await page.goto(scopedPath("settings/commit-signing"));
  await expect(
    page.getByText("Not registered with GitHub", { exact: true })
  ).toBeVisible();
  registrationStatus = "registered";
  registered = true;
  await page.getByRole("button", { name: "Check GitHub registration" }).click();
  await expect(
    page.getByText("Registered with GitHub", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Register with GitHub", exact: true })
  ).toBeDisabled();
  await expect(page.getByText(publicKey, { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("registered-signing-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("registered-signing-mobile.png"),
    fullPage: true,
  });
  registrationStatus = "unavailable";
  await page.getByRole("button", { name: "Check GitHub registration" }).click();
  await expect(
    page.getByText("GitHub registration could not be checked", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Registered with GitHub", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText("Not registered with GitHub", { exact: true })
  ).toHaveCount(0);
  registrationStatus = "not_registered";
  registered = false;
  await page.getByRole("button", { name: "Check GitHub registration" }).click();
  await expect(
    page.getByText("Not registered with GitHub", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Register with GitHub", exact: true })
  ).toBeEnabled();
});

test("temporary registration failures keep the key visible and can be retried", async ({
  page,
}) => {
  let attempts = 0;
  const saved = {
    ...empty,
    configured: true,
    publicKey: "ssh-ed25519 public-test-key",
    fingerprint: "SHA256:public-test-fingerprint",
  };
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "POST") {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error:
              "GitHub registration is temporarily unavailable. Your signing key is saved. Please try again.",
            retryable: true,
          }),
        });
        return;
      }
    }
    await fulfillJson(route, { ...saved, registered: attempts > 1 });
  });
  await page.goto(scopedPath("settings/commit-signing"));
  await page.getByRole("button", { name: "Register with GitHub" }).click();
  await expect(
    page.getByText("Please try again.", { exact: false })
  ).toBeVisible();
  await expect(page.getByText(saved.publicKey, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Connect your GitHub account", { exact: false })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Register with GitHub" }).click();
  await expect(
    page.getByText("Registered with GitHub", { exact: true })
  ).toBeVisible();
  expect(attempts).toBe(2);
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
    page.getByText("Signing key saved", { exact: true })
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
  await expect(page.getByRole("alertdialog")).toContainText(
    "Existing workspaces may still contain a copy"
  );
  await page
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Generate a signing key" })
  ).toBeVisible();
  await expect(
    page.getByText("ssh-ed25519 public-test-key", { exact: true })
  ).toHaveCount(0);
});

test("saved keys expose copy, honest workspace verification, and cancellable removal", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 390, height: 844 });
  const key = {
    ...empty,
    configured: true,
    publicKey: "ssh-ed25519 public-test-key",
    fingerprint: "SHA256:public-test-fingerprint",
  };
  let deleted = false;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "DELETE") deleted = true;
    await fulfillJson(route, key);
  });
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, {
      sandboxes: [
        {
          id: "00000000-0000-4000-8000-000000000777",
          sandbox_id: "workspace",
          working_branch: "feature/signing",
          repo: { full_name: "acme/widgets" },
        },
      ],
    })
  );
  let checks = 0;
  await page.route("**/api/sandbox/*/commit-signing", async (route) => {
    checks++;
    await fulfillJson(
      route,
      checks === 1
        ? {
            status: "paused",
            message:
              "Resume this workspace before verifying signing. Verification does not start it automatically.",
          }
        : {
            status: "verified",
            message:
              "This workspace signed and verified a test commit with your saved key. Your repository was not changed.",
            fingerprint: key.fingerprint,
            checkedAt: "2026-11-17T17:00:00Z",
          }
    );
  });
  await page.goto(scopedPath("settings/commit-signing"));
  await expect(
    page.getByText("Not registered with GitHub", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Not verified in a workspace", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy public key" }).click();
  await expect(
    page.getByText("Public key copied.", { exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    key.publicKey
  );
  await page
    .getByRole("button", { name: "Remove stored key", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "GitHub will continue trusting it"
  );
  await page.getByRole("button", { name: "Keep key" }).click();
  expect(deleted).toBe(false);
  await page
    .getByRole("button", { name: "Verify signing", exact: true })
    .click();
  await page
    .getByLabel("Workspace to check")
    .selectOption("00000000-0000-4000-8000-000000000777");
  await page.getByRole("button", { name: "Verify selected workspace" }).click();
  await expect(
    page.getByText("Resume this workspace before verifying", { exact: false })
  ).toBeVisible();
  await expect(
    page.getByText("Not verified in a workspace", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Verify selected workspace" }).click();
  await expect(
    page.getByText("Verified in the selected workspace", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Not registered with GitHub", { exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("signing-settings-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: test.info().outputPath("signing-settings-desktop.png"),
    fullPage: true,
  });
});

test("a temporary settings outage does not say signing is disabled", async ({
  page,
}) => {
  let reads = 0;
  await page.route(endpoint, async (route) => {
    reads++;
    if (reads === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Try again", retryable: true },
      });
    await fulfillJson(route, empty);
  });
  await page.goto(scopedPath("settings/commit-signing"));
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not load commit signing settings" })
  ).toContainText("Could not load commit signing settings");
  await expect(
    page.getByText("Commit signing is not configured", { exact: false })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate a signing key" })
  ).toBeVisible();
});
