import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  fulfillJson,
  initializeTrackedEvents,
  mockProjectsDashboard,
  syncedRepo,
} from "./helpers/activation-fixtures";

for (const compact of [false, true]) {
  test(`repositories and sandboxes have separate destinations (${compact ? "compact" : "expanded"})`, async ({
    page,
  }, testInfo) => {
    await initializeTrackedEvents(page);
    await enableScopedE2EAuth(page);
    await mockProjectsDashboard(page, {
      user: connectedUser,
      repos: [syncedRepo],
      sandboxes: [],
    });
    await page.route("**/api/memberships", (route) =>
      fulfillJson(route, {
        personal: { slug: "alex", name: "Alex", avatarUrl: null },
        teams: [],
      })
    );
    await page.addInitScript((collapsed) => {
      localStorage.setItem("mogplex.appSidebar.collapsed", String(collapsed));
    }, compact);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(scopedPath("projects/repositories"));

    const repositories = page.getByTestId("app-nav-workspaces");
    const sandboxes = page.getByTestId("app-nav-sandboxes");
    const projectTabs = page.getByRole("navigation", {
      name: "Projects sections",
    });
    await expect(repositories).toHaveAttribute("aria-current", "page");
    await expect(projectTabs).toBeVisible();

    await sandboxes.click();
    await expect(
      page.getByRole("heading", { name: "Sandboxes", exact: true })
    ).toBeVisible();
    await expect(page).toHaveURL(scopedPath("sandboxes"));
    await expect(projectTabs).toHaveCount(0);
    await expect(sandboxes).toHaveAttribute("aria-current", "page");
    await expect(repositories).not.toHaveAttribute("aria-current", "page");
    await page.screenshot({ path: testInfo.outputPath("sandboxes.png") });

    await repositories.click();
    await expect(page).toHaveURL(scopedPath("projects/repositories"));
    await expect(projectTabs).toBeVisible();
    await expect(repositories).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: "Sandboxes", exact: true })
    ).toHaveCount(0);

    await page.goto(scopedPath("projects/repositories/sandboxes"));
    await expect(page).toHaveURL(scopedPath("sandboxes"));
    await expect(projectTabs).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Sandboxes", exact: true })
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to repositories" }).click();
    await expect(page).toHaveURL(scopedPath("projects/repositories"));
  });
}
