import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockSettingsPageData,
} from "./helpers/theme-settings-fixtures";

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

  await page.goto(scopedPath("projects/repositories"));
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
  await expect(page).toHaveURL(/\/gamma\/projects\/repositories$/);
});
