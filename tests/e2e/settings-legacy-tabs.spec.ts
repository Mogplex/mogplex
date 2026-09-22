import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockSettingsShell,
} from "./helpers/billing-settings-fixtures";

test.beforeEach(async ({ page }) => {
  // Account settings can mount before the legacy tab redirect completes.
  await page.route("**/api/settings/decision-checks", (route) =>
    fulfillJson(route, { enabled: true, viewer: { canManage: true } })
  );
});

test("legacy Settings agents tab redirects to the Agents route", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);

  await page.goto(scopedPath("settings?tab=agents"));

  await expect(page).toHaveURL(new RegExp(`${scopedPath("agents/roster")}$`));
  await expect(page.getByTestId("app-nav-agents")).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(page.getByRole("tab", { name: "Agents" })).toHaveCount(0);
});

test("legacy Settings models hash still redirects to the catalog", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);

  await page.goto(scopedPath("settings#models"));

  await expect(page).toHaveURL(new RegExp(`${scopedPath("models/catalog")}$`));
});
