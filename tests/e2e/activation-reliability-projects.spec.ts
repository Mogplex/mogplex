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

test("projects empty state prioritizes completing the GitHub App install over importing repos", async ({
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

  await page.goto(scopedPath("projects/repositories"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText(
      "Finish the GitHub App install, then create your first project."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Complete GitHub App install" }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import repositories" })
  ).toHaveCount(0);
});

test("projects empty state allows importing repos when OAuth is connected but app install is pending", async ({
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

  await page.goto(scopedPath("projects/repositories"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText(
      "GitHub is connected. Import repos now, then finish the GitHub App install for trigger coverage."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import repositories" })
  ).toBeVisible();
});

test("projects dashboard surfaces data-load failures instead of empty onboarding when synced spaces exist", async ({
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
        "GitHub App coverage is active and synced repos are available in Spaces.",
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

  await page.goto(scopedPath("projects/repositories"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText("Failed to load projects and spaces.")
  ).toBeVisible();
  await expect(page.getByText("Failed to load spaces")).toBeVisible();
  await expect(page.getByText("142 synced spaces")).toBeVisible();
  await expect(page.getByText("Create your first project.")).toHaveCount(0);
  await expect(
    page.getByText("GitHub repo sync failed. Retry sync.")
  ).toHaveCount(0);
});
