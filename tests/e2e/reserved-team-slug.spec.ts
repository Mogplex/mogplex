import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

test("team creation rejects Control's route name", async ({ page }) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.goto("/new/team");
  await page.getByLabel("Team name", { exact: true }).fill("Control");
  await page.getByLabel("URL slug", { exact: true }).fill("control");
  await expect(
    page.getByText("Slug is reserved", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create team", exact: true })
  ).toBeDisabled();
});
