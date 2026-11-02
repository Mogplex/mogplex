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
  test(`sandboxes have their own destination and old repositories URLs land in Command Center (${compact ? "compact" : "expanded"})`, async ({
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
    await page.goto(scopedPath("sandboxes"));

    const sandboxes = page.getByTestId("app-nav-sandboxes");
    await expect(
      page.getByRole("heading", { name: "Sandboxes", exact: true })
    ).toBeVisible();
    await expect(sandboxes).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("app-nav-workspaces")).toHaveCount(0);
    await expect(page.getByTestId("app-nav-control")).not.toHaveAttribute(
      "aria-current",
      "page"
    );
    await page.screenshot({ path: testInfo.outputPath("sandboxes.png") });

    await page.getByRole("link", { name: "Back to Command Center" }).click();
    await expect(page).toHaveURL(scopedPath("control"));

    await page.goto(scopedPath("projects/repositories"));
    await expect(page).toHaveURL(scopedPath("control"));
    await page.goto(scopedPath("projects/repositories/sandboxes"));
    await expect(page).toHaveURL(scopedPath("sandboxes"));
  });
}
