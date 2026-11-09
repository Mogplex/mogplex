import { expect, test } from "./helpers/run-checks-fixtures";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  modelId,
  model,
  workspace,
  repo,
  fulfillJson,
  mockSettingsPageData,
} from "./helpers/theme-settings-fixtures";

test("settings renders org-scoped GitHub installation links", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(page, [
    {
      id: "inst-1",
      installation_id: 117860437,
      account_login: "acme",
      account_type: "Organization",
      target_type: "Organization",
      repository_count: 1,
      synced_repo_count: 1,
      scope_label: "Org",
      manage_url:
        "https://github.com/organizations/acme/settings/installations/117860437",
      repositories: [{ id: repo.id, full_name: repo.full_name }],
    },
  ]);

  await page.goto(scopedPath("settings?tab=account"));
  await page.waitForLoadState("networkidle");

  const manageLink = page.getByRole("link", { name: "Manage on GitHub" });
  await expect(manageLink).toHaveAttribute(
    "href",
    "https://github.com/organizations/acme/settings/installations/117860437"
  );
});

test("settings lists each GitHub account once and keeps an add-install entry point after setup", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(
    page,
    [
      {
        id: "inst-1",
        installation_id: 117860437,
        account_login: "acme",
        account_type: "Organization",
        target_type: "Organization",
        repository_count: 1,
        synced_repo_count: 1,
        scope_label: "Org",
        manage_url:
          "https://github.com/organizations/acme/settings/installations/117860437",
        repositories: [{ id: repo.id, full_name: repo.full_name }],
      },
    ],
    [
      {
        login: "alex",
        kind: "personal",
        github_installation_id: null,
        scope_label: "Personal",
        source: "oauth",
      },
      {
        login: "acme",
        kind: "org",
        github_installation_id: 117860437,
        scope_label: "Org",
        source: "oauth+installation",
      },
    ],
    {
      ...connectedUser,
      github_state: "app_installed_with_synced_repos",
      github_status_label: "Ready",
      github_status_detail:
        "Mogplex can work on the repositories in your connected accounts.",
      github_primary_action: null,
      github_installation_count: 1,
      github_synced_repo_count: 1,
    }
  );

  await page.goto(scopedPath("settings?tab=account"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("settings-github-add-install")).toHaveAttribute(
    "href",
    "/api/auth/github"
  );
  // One row per account: acme is both an owner target and an installation.
  const accounts = page.getByRole("list", { name: "GitHub accounts" });
  const rows = accounts.getByTestId("settings-github-account");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("acme");
  await expect(rows.nth(0)).toContainText("Organization · 1 repo in Mogplex");
  await expect(
    rows.nth(0).getByRole("link", { name: "Manage on GitHub" })
  ).toBeVisible();
  await expect(rows.nth(1)).toContainText("alex");
  await expect(rows.nth(1)).toContainText("Personal account · Not connected");
  await expect(
    rows.nth(1).getByRole("link", { name: "Connect" })
  ).toHaveAttribute("href", "/api/auth/github");
  await expect(page.getByText(/scope/i)).toHaveCount(0);
});

test("settings hides broken GitHub installation manage links when metadata is incomplete", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(page, [
    {
      id: "inst-1",
      installation_id: 117860437,
      account_login: "acme",
      account_type: null,
      target_type: null,
      repository_count: 1,
      synced_repo_count: 1,
      scope_label: "Account",
      manage_url: null,
      repositories: [{ id: repo.id, full_name: repo.full_name }],
    },
  ]);

  await page.goto(scopedPath("settings?tab=account"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText(
      "Manage in GitHub settings unavailable until installation metadata is refreshed"
    )
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Manage on GitHub" })
  ).toHaveCount(0);
});

test("settings surfaces installation load failures without crashing", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    fulfillJson(route, { default_model: modelId, theme: "light" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, { error: "Failed to load GitHub installations" }, 500)
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/workspaces", (route) =>
    fulfillJson(route, [workspace])
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );

  await page.goto(scopedPath("settings?tab=account"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText("Unable to load GitHub App installations")
  ).toBeVisible();
  await expect(
    page.getByText(/Mogplex works on repositories in the GitHub accounts/)
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("settings surfaces settings preference load failures without crashing", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    fulfillJson(route, { error: "Failed to load settings" }, 500)
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/workspaces", (route) =>
    fulfillJson(route, [workspace])
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );

  await page.goto(scopedPath("settings?tab=account"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText("Unable to load settings preferences")
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Account", exact: true })
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});
