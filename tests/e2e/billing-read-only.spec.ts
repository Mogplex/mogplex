import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { capacitySummary } from "./helpers/billing";
import {
  fulfillJson,
  mockSettingsShell,
} from "./helpers/billing-settings-fixtures";

test("read-only individual Billing keeps capacity guidance", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);
  await page.route("**/api/billing/capacity", (route) =>
    fulfillJson(
      route,
      capacitySummary({
        account: {
          id: "billing-account-read-only",
          eventSequence: "5",
          enforcementMode: "shadow",
          scope: "personal",
          displayName: "Alex",
          status: "read_only",
          canManageBilling: false,
          hasSubscription: true,
          hasBillingHistory: true,
        },
      })
    )
  );

  await page.goto(scopedPath("settings?tab=billing"));

  await expect(
    page.getByText("Ask a company owner or admin to change billing.")
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Capacity add-ons" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Add|Manage/ })).toHaveCount(0);
});

test("company-managed legacy Billing omits capacity add-ons", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);
  await page.route("**/api/billing/capacity", (route) =>
    fulfillJson(
      route,
      capacitySummary({
        plan: {
          ref: "legacy",
          name: "Company plan",
          offerKind: "legacy",
          interval: "contract",
          recurringAmountCents: null,
          renewsAt: null,
          cancelsAt: null,
          namedUserLimit: null,
        },
      })
    )
  );

  await page.goto(scopedPath("settings?tab=billing"));

  await expect(
    page.getByRole("heading", { name: /Capacity add-ons|Storage add-ons/ })
  ).toHaveCount(0);
});
