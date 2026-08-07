import { expect, test } from "@playwright/test";
import {
  getTrackedEvents,
  initializeTrackedEvents,
  waitForTrackedEvent,
} from "./helpers/activation-fixtures";

test("beta login page shows the waitlist gate form ready for input", async ({
  page,
}) => {
  await page.goto("/login/beta");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("waitlist-gate-form")).toBeVisible();
  await expect(page.getByTestId("waitlist-code-input")).toBeVisible();
  await expect(page.getByTestId("login-github-button")).toHaveAttribute(
    "data-ready",
    "true"
  );
});

test("beta login CTA tracks login_started after the waitlist code is validated", async ({
  page,
}) => {
  await initializeTrackedEvents(page);

  // Stub a successful validation so the submit handler proceeds to track and
  // would otherwise navigate to /api/auth/login/github.
  await page.route("**/api/auth/waitlist/validate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  // Catch the GitHub-init navigation so we don't actually leave the page.
  await page.route("**/api/auth/login/github*", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/login/beta");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("waitlist-code-input").fill("e2e-test-code");
  await page.getByTestId("login-github-button").click();

  await waitForTrackedEvent(page, "login_started");
  const events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "login_started",
      properties: expect.objectContaining({
        source: "login_page",
        provider: "github",
      }),
    })
  );
});

test("login landing surfaces session-expired notice", async ({ page }) => {
  await page.goto(
    "/login?expired=true&next=%2Fcli-auth%3Fcallback%3Dhttp%253A%252F%252Flocalhost%253A45454%252Fcallback"
  );
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("session expired")).toBeVisible();
  // /login is the better-auth sign-in page now; the expired notice renders
  // above the email/password form.
  await expect(page.getByTestId("signin-form")).toBeVisible();
});
