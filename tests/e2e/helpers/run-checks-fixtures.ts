import { expect, test as base, type Page } from "@playwright/test";
import type { TeamRole } from "@/lib/team-capabilities";
import { buildE2EAuthHeaders, E2E_SCOPE_USER } from "./auth";
import { fulfillJson, mockSettingsShell } from "./billing-settings-fixtures";

// These are browser UI tests with mocked APIs, not database integration tests.
// Fail on new shell dependencies instead of silently reaching a local database.
export const test = base.extend({
  page: async ({ page }, runTest) => {
    const unmocked: string[] = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      unmocked.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.abort("blockedbyclient");
    });
    await mockSettingsShell(page);
    await runTest(page);
    await page.close();
    expect(
      unmocked,
      "Every settings API request must have an explicit fixture"
    ).toEqual([]);
  },
});

export const TEAM = {
  id: "00000000-0000-4000-8000-000000000002",
  slug: "acme",
  name: "Acme",
  iconUrl: null,
};
export const TEAM_ENDPOINT = `**/api/teams/${TEAM.id}/decision-checks`;
export const TEAM_SETTINGS_PATH = `/${TEAM.slug}/settings`;

export async function mockTeamSettings(page: Page, role: TeamRole = "owner") {
  const canManage = role === "owner" || role === "admin";
  const viewer = { role, canManage };
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(E2E_SCOPE_USER.id),
    "x-mogplex-scope-kind": "team",
    "x-mogplex-scope-slug": TEAM.slug,
    "x-mogplex-scope-id": TEAM.id,
  });
  await page.route("**/api/memberships", (route) =>
    fulfillJson(route, {
      personal: {
        slug: E2E_SCOPE_USER.username,
        name: "Alex",
        avatarUrl: null,
      },
      teams: [{ ...TEAM, role }],
    })
  );
  await page.route(`**/api/teams/${TEAM.id}/members`, (route) =>
    fulfillJson(route, { team: TEAM, viewer, members: [], invites: [] })
  );
  await page.route(`**/api/teams/${TEAM.id}/keys`, (route) =>
    fulfillJson(route, { keys: [], viewer })
  );
  await page.route(`**/api/teams/${TEAM.id}/models`, (route) =>
    fulfillJson(route, { modelAllowlist: null, viewer: { canManage } })
  );
  await page.route(`**/api/teams/${TEAM.id}/audit-events`, (route) =>
    fulfillJson(route, { events: [] })
  );
}

export { expect } from "@playwright/test";
export { fulfillJson } from "./billing-settings-fixtures";
