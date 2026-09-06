import { expect, test } from "@playwright/test";
import {
  getTrackedEvents,
  initializeTrackedEvents,
  waitForTrackedEvent,
} from "./helpers/activation-fixtures";

test("legacy beta login redirects to current sign-in and preserves the destination", async ({
  page,
}) => {
  await page.goto("/login/beta?next=%2Finvite%2Fexample");
  await expect(page).toHaveURL(/\/login\?next=%2Finvite%2Fexample$/);
  await expect(page.getByTestId("signin-form")).toBeVisible();
  await expect(page.getByTestId("waitlist-gate-form")).toHaveCount(0);
});

test("current login CTA tracks login_started without the retired waitlist", async ({
  page,
}) => {
  await initializeTrackedEvents(page);

  // Stay on the login page after an attempted sign-in; no real credentials.
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Invalid credentials" }),
    });
  });

  await page.goto("/login/beta");
  await page.getByTestId("signin-email").fill("login@example.test");
  await page.getByTestId("signin-password").fill("not-a-real-password");
  await page.getByTestId("signin-submit").click();

  await waitForTrackedEvent(page, "login_started");
  const events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "login_started",
      properties: expect.objectContaining({
        source: "login_page",
        provider: "password",
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
