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

async function installTeamRepositories(page: Page) {
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
    fulfillJson(route, [{ id: "agent-1", name: "Reviewer" }])
  );
  await page.route("**/api/assignments", (route) =>
    fulfillJson(route, [
      {
        id: "assignment-1",
        repo_id: "team-repo",
        agent_id: "agent-1",
        enabled: true,
      },
    ])
  );
  const teams: Array<string | undefined> = [];
  await page.route("**/api/repos", (route) => {
    const teamId = route.request().headers()["x-mogplex-team-id"];
    teams.push(teamId);
    return fulfillJson(route, [
      {
        id: teamId ? "team-repo" : "personal-repo",
        full_name: teamId ? "acme/team-project" : "alex/personal-project",
        owner: teamId ? "acme" : "alex",
        name: teamId ? "team-project" : "personal-project",
      },
    ]);
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
