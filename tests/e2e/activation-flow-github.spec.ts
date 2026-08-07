import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  disconnectedGithubUser,
  getTrackedEvents,
  initializeTrackedEvents,
  mockHomeState,
  mockSettingsPage,
  waitForTrackedEvent,
} from "./helpers/activation-fixtures";

const workspacePath = `/${connectedUser.username}/projects/workspace`;

test("settings GitHub CTA tracks github_connect_started", async ({ page }) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockSettingsPage(page, disconnectedGithubUser);
  await page.goto(scopedPath("settings"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("settings-github-connect")).toBeVisible();
  await page.getByTestId("settings-github-connect").evaluate((element) => {
    element.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
  });

  await page.getByTestId("settings-github-connect").dispatchEvent("click");

  await waitForTrackedEvent(page, "github_connect_started");
  const events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "github_connect_started",
      properties: expect.objectContaining({
        source: "settings_github_card",
        connection_mode: "oauth",
      }),
    })
  );
});

test("home setup GitHub CTA tracks github_connect_started", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockHomeState(page, {
    user: disconnectedGithubUser,
    repos: [],
  });
  await page.route("**/api/auth/github", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>ok</body></html>",
    });
  });
  await page.goto(workspacePath);
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("button", { name: "Connect GitHub" }).first()
  ).toBeVisible();

  await Promise.all([
    page.waitForURL("**/api/auth/github"),
    page.getByRole("button", { name: "Connect GitHub" }).first().click(),
  ]);

  const events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "github_connect_started",
      properties: expect.objectContaining({
        source: "home_setup",
        connection_mode: "oauth",
      }),
    })
  );
});
