import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
} from "./helpers/activation-fixtures";

test("sandbox stop reconciles preview and chrome without stale live state", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  const readyBadges = page.getByText("ready", { exact: true });
  await expect(readyBadges.first()).toBeVisible();
  await expect(page.getByText(/\d+m left/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Health", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop environment" })
  ).toBeVisible();

  const stopResponse = page.waitForResponse(
    (response) =>
      /\/api(?:\/sandbox){2}-record-repo-1\/stop$/.test(response.url()) &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Stop environment" }).click();
  await stopResponse;

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const stoppedChip = page
    .locator("span.inline-flex")
    .filter({ hasText: /^stopped$/ })
    .first();
  await expect(stoppedChip).toBeVisible();
  await expect(stoppedChip).toHaveText("stopped");
  await expect(readyBadges).toHaveCount(0);

  // PR6: stopped overlay exposes both restart-on-branch and start-fresh.
  await expect(
    page.getByRole("button", { name: "Restart on this branch" })
  ).toBeVisible();
  const startFresh = page.getByRole("button", { name: /Start fresh/ });
  await expect(startFresh).toBeVisible();
  await startFresh.click();
  await expect(
    page.getByRole("dialog").getByText("Start a new sandbox")
  ).toBeVisible();
});

test("fresh Start fresh failures from the stopped overlay render inline", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const harness = await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  await expect(page.getByText("ready", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Health", exact: true }).click();

  const stopResponse = page.waitForResponse(
    (response) =>
      /\/api(?:\/sandbox){2}-record-repo-1\/stop$/.test(response.url()) &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Stop environment" }).click();
  await stopResponse;

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const previewStage = page.getByTestId("preview-stage");
  await expect(
    previewStage.getByRole("button", { name: "Restart on this branch" })
  ).toBeVisible();

  harness.setSandboxLaunchError({
    error: "Fresh stopped-overlay launch failed",
    status: 500,
  });

  await previewStage.getByRole("button", { name: /Start fresh/ }).click();
  const launchDialog = page.getByRole("dialog");
  await expect(launchDialog).toBeVisible();
  await launchDialog.getByRole("button", { name: "Start Sandbox" }).click();

  await expect(previewStage.getByText("Sandbox launch failed")).toBeVisible();
  await expect(
    previewStage.getByText("Fresh stopped-overlay launch failed")
  ).toBeVisible();
});

test("session overflow menu offers a Start fresh sandbox affordance", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  await expect(page.getByText("ready", { exact: true }).first()).toBeVisible();

  await page.getByTestId("session-tab-1").click({
    button: "right",
  });
  await page.getByRole("menuitem", { name: "Start fresh sandbox…" }).click();

  await expect(
    page.getByRole("dialog").getByText("Start a new sandbox")
  ).toBeVisible();
});

test("server-side sandbox stops propagate on health reconciliation", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const harness = await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  const readyBadges = page.getByText("ready", { exact: true });
  await expect(readyBadges.first()).toBeVisible();
  await expect(page.getByText(/\d+m left/i)).toHaveCount(0);

  harness.setSandboxState("repo-1", {
    status: "stopped",
    health_status: "stopped",
  });

  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(
    page.getByText("stopped", { exact: true }).first()
  ).toBeVisible();
  await expect(readyBadges).toHaveCount(0);
});
