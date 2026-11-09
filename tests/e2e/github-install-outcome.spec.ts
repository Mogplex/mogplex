import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockSettingsShell,
} from "./helpers/billing-settings-fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/settings/decision-checks", (route) =>
    fulfillJson(route, { enabled: true, viewer: { canManage: true } })
  );
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);
});

test("should explain why a GitHub connection failed and clear the result from the URL", async ({
  page,
}) => {
  await page.goto(
    scopedPath(
      "settings/account?github=error&reason=github_installation_owner_required"
    )
  );

  await expect(
    page.getByText("Only an owner can connect this account", { exact: true })
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`${scopedPath("settings/account")}$`)
  );
});

test("should confirm a GitHub connection when it lands on the legacy Settings URL", async ({
  page,
}) => {
  await page.goto(scopedPath("settings?github=connected"));

  await expect(
    page.getByText("GitHub connected", { exact: true })
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`${scopedPath("settings/account")}$`)
  );
});
