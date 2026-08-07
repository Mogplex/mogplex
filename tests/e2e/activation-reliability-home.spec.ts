import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  disconnectedGithubUser,
  initializeTrackedEvents,
  mockHomeState,
  syncedRepo,
} from "./helpers/activation-fixtures";
import { oauthInstallPendingUser } from "./helpers/activation-reliability-fixtures";

test("home prioritizes opening a workspace when repos already exist, even if GitHub is currently disconnected", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockHomeState(page, {
    user: disconnectedGithubUser,
    repos: [syncedRepo],
  });

  await page.goto(scopedPath("projects/workspace"));

  await expect(
    page.getByText("Open Workspace is the main action.")
  ).toBeVisible();
  await expect(page.getByTestId("home-open-workspace-repo-1")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect GitHub" })
  ).toHaveCount(0);
  await expect(page.getByText("next: Open a workspace")).toBeVisible();
});

test("home setup guide shows complete-install action when GitHub App install is pending", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockHomeState(page, {
    user: oauthInstallPendingUser,
    repos: [],
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText(
      "Finish the GitHub App install in GitHub. Mogplex will pick up the installation and sync coverage."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete GitHub App install" }).first()
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync repos" })).toBeVisible();
});

test("home sync failure surfaces retry guidance", async ({ page }) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockHomeState(page, {
    user: connectedUser,
    repos: [],
    githubSyncResponse: {
      ok: false,
      status: 500,
      error: "GITHUB_SYNC_ERROR",
    },
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();

  await expect(
    page.getByText("GitHub repo sync failed. Retry sync.")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import spaces" })
  ).toBeVisible();
});

test("home surfaces repo load failures without crashing the shell", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockHomeState(page, {
    user: connectedUser,
    repos: [],
    reposError: {
      status: 500,
      error: "Failed to load repos",
    },
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Failed to load repos")).toBeVisible();
  await expect(
    page.getByText("First successful action: open a workspace.")
  ).toBeVisible();
  await expect(page.getByText("next: Sync spaces")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});
