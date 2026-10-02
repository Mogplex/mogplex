import { expect, test, type Page } from "@playwright/test";
import { buildE2EAuthHeaders, E2E_SCOPE_USER } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

const team = {
  id: "00000000-0000-4000-8000-000000000002",
  slug: "acme",
  name: "Acme",
  iconUrl: null,
};

async function installTeamRepositories(page: Page, canManage = true) {
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(E2E_SCOPE_USER.id),
    "x-mogplex-scope-kind": "team",
    "x-mogplex-scope-slug": team.slug,
    "x-mogplex-scope-id": team.id,
  });
  await mockBaseChrome(page);
  await page.route("**/api/memberships", (route) =>
    fulfillJson(route, {
      personal: {
        slug: E2E_SCOPE_USER.username,
        name: "Alex",
        avatarUrl: null,
      },
      teams: [{ ...team, role: "owner" }],
    })
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [
      {
        id: "agent-1",
        name:
          route.request().headers()["x-mogplex-team-id"] === team.id
            ? "Reviewer"
            : "Personal agent",
      },
    ])
  );
  await page.route("**/api/assignments", (route) =>
    fulfillJson(route, [
      {
        id: "assignment-1",
        repo_id:
          route.request().headers()["x-mogplex-team-id"] === team.id
            ? "team-repo"
            : "personal-repo",
        agent_id: "agent-1",
        enabled: true,
        can_manage: canManage,
      },
    ])
  );
  const teams: Array<string | undefined> = [];
  await page.route("**/api/repos**", (route) => {
    const teamId = route.request().headers()["x-mogplex-team-id"];
    teams.push(teamId);
    const rows = [
      {
        id: teamId ? "team-repo" : "personal-repo",
        full_name: teamId ? "acme/team-project" : "alex/personal-project",
        owner: teamId ? "acme" : "alex",
        name: teamId ? "team-project" : "personal-project",
        github_installation_id: 42,
        github_prefer_installation_coverage: true,
      },
      {
        id: "hidden-team-repo",
        full_name: "acme/removed-project",
        owner: "acme",
        name: "removed-project",
        is_hidden: true,
      },
      {
        id: "legacy-repo",
        full_name: "acme/legacy-project",
        name: "legacy-project",
        owner: "acme",
        github_prefer_installation_coverage: true,
      },
    ];
    return fulfillJson(
      route,
      new URL(route.request().url()).searchParams.get("show_hidden") === "true"
        ? rows
        : rows.filter((row) => !row.is_hidden)
    );
  });
  await page.route("**/api/workspaces", (route) => fulfillJson(route, []));
  await page.route("**/api/github/repos", (route) =>
    fulfillJson(route, [
      {
        id: "team-repo",
        full_name: "acme/team-project",
        owner: "acme",
        name: "team-project",
      },
    ])
  );
  return teams;
}

test("team assignments and dashboard chrome share one team repository request", async ({
  page,
}) => {
  const teams = await installTeamRepositories(page);
  await page.goto("/acme/assignments");
  await expect(page.getByText("team-project → Reviewer")).toBeVisible();
  await expect(page.locator(".app-statusbar")).toContainText("repos: 1");
  expect(teams).toEqual([team.id]);
});

test("removed team repositories remain available without a second cache request", async ({
  page,
}) => {
  const teams = await installTeamRepositories(page);
  await page.goto("/acme/projects/repositories");
  await expect(
    page.getByRole("button", { name: "Show removed" })
  ).toBeVisible();
  await expect(page.getByText("removed-project", { exact: true })).toHaveCount(
    0
  );
  await page.getByRole("button", { name: "Show removed" }).click();
  await expect(
    page.getByText("removed-project", { exact: true }).first()
  ).toBeVisible();
  await expect(page.locator(".app-statusbar")).toContainText("repos: 1");
  expect(teams).toEqual([team.id]);
});

test("team Projects and status bar share the scoped repository cache", async ({
  page,
}) => {
  const teams = await installTeamRepositories(page);
  await page.goto("/acme/projects/repositories");
  await expect(
    page.getByText("team-project", { exact: true }).first()
  ).toBeVisible();
  await expect(page.locator(".app-statusbar")).toContainText("repos: 1");
  expect(teams).toEqual([team.id]);
});

test("team viewers see assignments with management disabled", async ({
  page,
}) => {
  await installTeamRepositories(page, false);
  await page.goto("/acme/assignments");
  await expect(page.getByText("team-project → Reviewer")).toBeVisible();
  await page.getByRole("button", { name: "Assignment actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
});

test("team managers delete an assignment with the active team header", async ({
  page,
}) => {
  await installTeamRepositories(page);
  const deletes: Array<string | undefined> = [];
  await page.route("**/api/assignments?id=*", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    deletes.push(route.request().headers()["x-mogplex-team-id"]);
    await fulfillJson(route, { ok: true });
  });
  await page.goto("/acme/assignments");
  await expect(page.getByText("team-project → Reviewer")).toBeVisible();
  await page.getByRole("button", { name: "Assignment actions" }).click();
  const deleted = page.waitForResponse(
    (response) =>
      response.url().includes("/api/assignments?id=") &&
      response.request().method() === "DELETE"
  );
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await deleted;
  expect(deletes).toEqual([team.id]);
});
