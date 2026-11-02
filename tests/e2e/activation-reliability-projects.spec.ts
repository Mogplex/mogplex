import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  initializeTrackedEvents,
  mockProjectsDashboard,
} from "./helpers/activation-fixtures";
import {
  installPendingUser,
  oauthInstallPendingUser,
} from "./helpers/activation-reliability-fixtures";

test("repository settings prioritize completing the GitHub App install over syncing", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockProjectsDashboard(page, {
    user: installPendingUser,
    repos: [],
    sandboxes: [],
    workspaces: [],
  });

  await page.goto(scopedPath("settings/repositories"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("link", { name: "Complete GitHub App install" }).first()
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync GitHub" })).toHaveCount(
    0
  );
});

test("repository settings allow syncing when OAuth is connected but app install is pending", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockProjectsDashboard(page, {
    user: oauthInstallPendingUser,
    repos: [],
    sandboxes: [],
    workspaces: [],
  });

  await page.goto(scopedPath("settings/repositories"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("button", { name: "Sync GitHub" })).toBeVisible();
  await expect(
    page.getByText("No connected repositories yet. Sync GitHub to import them.")
  ).toBeVisible();
});

test("repository settings surface data-load failures instead of an empty list", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockProjectsDashboard(page, {
    user: {
      ...connectedUser,
      github_app_available: true,
      github_app_connected: true,
      github_connection_mode: "app",
      github_state: "app_installed_with_synced_repos",
      github_status_label: "Ready",
      github_status_detail:
        "GitHub App coverage is active and synced repos are available.",
      github_primary_action: null,
      github_installation_count: 1,
      github_synced_repo_count: 142,
    },
    repos: [],
    sandboxes: [],
    workspaces: [],
    reposError: {
      status: 500,
      error: "Failed to load spaces",
    },
  });

  await page.goto(scopedPath("settings/repositories"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("alert").filter({ hasText: "Failed to load spaces" })
  ).toBeVisible();
  await expect(
    page.getByText("No connected repositories yet. Sync GitHub to import them.")
  ).toHaveCount(0);
});
