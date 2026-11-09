import { expect, type Page } from "@playwright/test";
import { enableScopedE2EAuth } from "./auth";
import {
  connectedUser,
  fulfillJson,
  mockBaseChrome,
} from "./automation-control-plane-fixtures";

/**
 * Settings → Repositories with mocked repositories (App-connected and legacy
 * OAuth rows), installations, and automations. `failedIds` make PATCHes for
 * those repositories fail; `githubUsername` sets the signed-in login.
 */
export async function dashboard(
  page: Page,
  failedIds: string[] = [],
  githubUsername?: string
) {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  if (githubUsername) {
    await page.route("**/api/auth/user", (route) =>
      fulfillJson(route, {
        user: { ...connectedUser, github_username: githubUsername },
      })
    );
  }
  // The repos API marks App coverage per repository; the legacy rows came
  // from the old OAuth sync and have no installation.
  const app = {
    github_app_covered: true,
    github_prefer_installation_coverage: true,
  };
  const legacy = {
    github_app_covered: false,
    github_prefer_installation_coverage: true,
  };
  const repos = [
    {
      id: "alpha",
      name: "alpha",
      full_name: "alex/alpha",
      owner: "alex",
      is_hidden: false,
      ...app,
      github_installation_id: 11,
    },
    {
      id: "beta",
      name: "beta",
      full_name: "alex/beta",
      owner: "alex",
      is_hidden: false,
      ...app,
      github_installation_id: 11,
    },
    {
      id: "removed",
      name: "removed",
      full_name: "alex/removed",
      owner: "alex",
      is_hidden: true,
      ...app,
      github_installation_id: 11,
    },
    {
      id: "acme-app",
      name: "app",
      full_name: "acme/app",
      owner: "acme",
      is_hidden: false,
      ...app,
      github_installation_id: 12,
    },
    {
      id: "other",
      name: "other",
      full_name: "team/other",
      owner: "team",
      is_hidden: false,
      ...app,
      github_installation_id: 13,
    },
    {
      // The App is installed for alex, but its repository access leaves
      // this one out.
      id: "alex-legacy",
      name: "legacy",
      full_name: "alex/legacy",
      owner: "alex",
      is_hidden: false,
      ...legacy,
    },
    {
      id: "fork",
      name: "docs",
      full_name: "skhard99/docs",
      owner: "skhard99",
      is_hidden: false,
      ...legacy,
    },
    {
      id: "old-fork",
      name: "docs",
      full_name: "blackboxaicode/docs",
      owner: "blackboxaicode",
      is_hidden: true,
      ...legacy,
    },
  ];
  const writes: { id: string; is_hidden: boolean }[] = [];
  await page.route("**/api/repos**", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        id: string;
        is_hidden: boolean;
      };
      writes.push(body);
      if (failedIds.includes(body.id))
        return fulfillJson(route, { error: "Database unavailable" }, 500);
      const repo = repos.find((row) => row.id === body.id)!;
      repo.is_hidden = body.is_hidden;
      return fulfillJson(route, repo);
    }
    return fulfillJson(route, repos);
  });
  await page.route("**/api/github/repos", (route) =>
    fulfillJson(
      route,
      repos.filter((repo) => !repo.is_hidden)
    )
  );
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const installationRequests = { count: 0 };
  await page.route("**/api/github/installations", (route) => {
    installationRequests.count += 1;
    return fulfillJson(route, [
      {
        installation_id: 11,
        account_login: "alex",
        account_type: "User",
        manage_url: "https://github.com/settings/installations/11",
        repos_synced_at: "2026-01-01T00:00:00Z",
      },
      {
        installation_id: 12,
        account_login: "acme",
        account_type: "Organization",
        manage_url:
          "https://github.com/organizations/acme/settings/installations/12",
        repos_synced_at: fiveMinutesAgo,
      },
      {
        installation_id: 13,
        account_login: "team",
        account_type: "Organization",
        manage_url: null,
        repos_synced_at: null,
      },
    ]);
  });
  const prFlow = (id: string, name: string, filter: object) => ({
    id,
    name,
    status: "active",
    source_kind: "github",
    published_version: {
      id: `${id}-v1`,
      flow_id: id,
      version_number: 1,
      created_at: "2026-11-01T00:00:00Z",
      graph: {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 0, y: 0 },
            data: { label: "PR opened", event: "pr_opened", filter },
          },
        ],
        edges: [],
      },
    },
  });
  await page.route("**/api/flows", (route) =>
    fulfillJson(route, [
      prFlow("review", "PR-Review", { scope: "org" }),
      prFlow("beta-check", "Beta check", {
        scope: "all",
        repos: ["alex/beta"],
      }),
    ])
  );
  for (const name of ["workspaces", "agents", "assignments", "memberships"]) {
    await page.route(`**/api/${name}`, (route) => fulfillJson(route, []));
  }
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.goto("/alex/settings/repositories");
  await expect(page.getByRole("button", { name: "Sync GitHub" })).toBeEnabled();
  return { repos, writes, installationRequests };
}

export const connected = (page: Page) =>
  page.getByRole("region", { name: "Connected repositories", exact: true });

export const repoLink = (page: Page, fullName: string) =>
  connected(page).getByRole("link", { name: `Open ${fullName} on GitHub` });
