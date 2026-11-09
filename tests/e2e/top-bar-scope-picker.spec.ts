import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockSettingsPageData,
} from "./helpers/theme-settings-fixtures";

const MEMBERSHIPS = {
  personal: { slug: "alex", name: "Alex Morgan", avatarUrl: null },
  teams: [
    {
      id: "team-1",
      slug: "acme",
      name: "Acme Operations",
      iconUrl: null,
      role: "developer",
    },
    {
      id: "team-2",
      slug: "gamma",
      name: "Gamma Research",
      iconUrl: "https://example.com/gamma.png",
      role: "owner",
    },
  ],
};

test("personal scope shows no team in the top bar, and Teams lists teams as links to their settings", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(page);
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/memberships", (route) =>
    fulfillJson(route, MEMBERSHIPS)
  );

  await page.goto(scopedPath("settings/teams"));
  const teams = page.getByRole("list", { name: "Teams" });
  await expect(teams.getByRole("link")).toHaveCount(2);
  const gamma = teams.getByRole("link", { name: /Gamma Research/ });
  await expect(gamma).toHaveAttribute("href", "/gamma/settings/members");
  await expect(gamma.locator("img")).toHaveAttribute(
    "src",
    "https://example.com/gamma.png"
  );
  await expect(gamma).toContainText("Owner");
  await expect(
    teams.getByRole("link", { name: /Acme Operations/ })
  ).toContainText("AO");
  // Member management lives on the team's own Settings, not nested here.
  await expect(page.getByPlaceholder("teammate@example.com")).toHaveCount(0);
  await expect(page.getByTestId("top-bar-active-team")).toHaveCount(0);
});

test("user menu filters projects and switches the selected scope by keyboard", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(page);
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/memberships", (route) =>
    fulfillJson(route, {
      personal: { slug: "alex", name: "Alex Morgan", avatarUrl: null },
      teams: [
        {
          id: "team-1",
          slug: "acme",
          name: "Acme Operations",
          iconUrl: null,
        },
        {
          id: "team-2",
          slug: "gamma",
          name: "Gamma Research",
          iconUrl: "https://example.com/gamma.png",
        },
      ],
    })
  );

  await page.goto(scopedPath("settings/repositories"));
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: /Switch project/i }).click();

  const search = page.getByPlaceholder("Search projects...");
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();

  const personalProject = page.getByRole("option", {
    name: /Alex Morgan/i,
  });
  await expect(personalProject).toHaveAttribute("aria-current", "true");
  await expect(personalProject.getByText("AM")).toBeVisible();

  await search.fill("gamma");
  await expect(
    page.getByRole("option", { name: /Gamma Research/i })
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /Acme Operations/i })
  ).toHaveCount(0);
  await expect(personalProject).toHaveCount(0);

  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/gamma\/settings\/repositories$/);
  const activeTeam = page.getByTestId("top-bar-active-team");
  await expect(activeTeam).toContainText("Gamma Research");
  await expect(activeTeam.locator("img")).toHaveAttribute(
    "src",
    "https://example.com/gamma.png"
  );
  await expect(
    page.getByRole("button", { name: "User menu, Gamma Research team" })
  ).toBeVisible();
});

test("top bar treats the personal slug as personal even if a team shares it", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(page);
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/memberships", (route) =>
    fulfillJson(route, {
      ...MEMBERSHIPS,
      teams: [
        ...MEMBERSHIPS.teams,
        {
          id: "team-3",
          slug: "alex",
          name: "Clash",
          iconUrl: null,
          role: "viewer",
        },
      ],
    })
  );

  await page.goto(scopedPath("settings/teams"));
  await expect(page.getByRole("list", { name: "Teams" })).toBeVisible();
  await expect(page.getByTestId("top-bar-active-team")).toHaveCount(0);
});
