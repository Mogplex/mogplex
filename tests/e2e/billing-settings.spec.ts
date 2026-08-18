import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import type { CapacityBillingSummaryV2 } from "@/lib/billing/capacity-summary-types";
import {
  buildE2EAuthHeaders,
  enableScopedE2EAuth,
  scopedPath,
} from "./helpers/auth";

const TEAM_ID = "00000000-0000-4000-8000-000000000002";
const TEAM_SLUG = "acme";

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

async function mockSettingsShell(page: Page) {
  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, {
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "alex@example.com",
        username: "alex",
        name: "Alex",
        avatar_url: "",
        github_connected: true,
        github_app_connected: true,
        github_app_available: true,
        platform_access: {
          allowPlatformAi: false,
          allowPlatformSandbox: false,
        },
        vercel: { connected: false },
      },
    })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    fulfillJson(route, { default_model: null, theme: "light" })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/memberships", (route) =>
    fulfillJson(route, {
      personal: { slug: "alex", name: "Alex", avatarUrl: null },
      teams: [],
    })
  );
  await page.route("**/api/workspaces", (route) => fulfillJson(route, []));
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) => fulfillJson(route, []));
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.route("**/api/billing/capacity/events?*", (route) =>
    route.fulfill({ status: 204 })
  );
}

function capacitySummary(
  overrides: Partial<CapacityBillingSummaryV2> = {}
): CapacityBillingSummaryV2 {
  return {
    version: "capacity_v2",
    asOf: "2026-08-17T12:00:00.000Z",
    billingOperationsEnabled: true,
    account: {
      id: "billing-account-1",
      eventSequence: "12",
      enforcementMode: "shadow",
      scope: "personal",
      displayName: "Alex",
      status: "active",
      canManageBilling: true,
      hasSubscription: true,
      hasBillingHistory: true,
    },
    plan: {
      ref: "plus",
      name: "Plus",
      offerKind: "individual",
      interval: "month",
      recurringAmountCents: 10_000,
      renewsAt: "2026-09-17T12:00:00.000Z",
      cancelsAt: null,
      namedUserLimit: 1,
    },
    concurrency: {
      active: 7,
      included: 25,
      addOn: 10,
      limit: 35,
      wouldBlock: false,
    },
    retainedData: {
      logicalBytes: "2300000000",
      includedBytes: "5000000000",
      addOnBytes: "0",
      limitBytes: "5000000000",
      percentUsed: 46,
      wouldBlock: false,
      overLimitAfterPendingChange: false,
    },
    hostedUsage: {
      includedRemainingCents: 1_800,
      purchasedRemainingCents: 1_000,
      openReservationsCents: 300,
      spendableCents: 2_500,
      grantResetsAt: "2026-09-17T12:00:00.000Z",
      purchasesFrozen: false,
    },
    addOns: [
      {
        subscriptionItemId: "si_concurrency",
        lookupKey: "capacity_v2_concurrency_10_monthly",
        kind: "concurrency",
        name: "Concurrency +10",
        quantity: 1,
        allowanceDelta: "10",
        recurringAmountCents: 500,
        status: "active",
        effectiveAt: "2026-08-17T12:00:00.000Z",
      },
    ],
    openReservations: [],
    recentCosts: [
      {
        operationId: "operation-1",
        description: "Run customer report",
        status: "settled",
        occurredAt: "2026-08-16T12:00:00.000Z",
        totalCents: 74,
        items: [{ category: "trigger", label: "Trigger.dev", amountCents: 74 }],
      },
    ],
    ...overrides,
  };
}

test("personal Billing shows capacity and reviews an add-on change", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);
  await page.route("**/api/billing/capacity", (route) =>
    fulfillJson(
      route,
      capacitySummary({
        hostedUsage: {
          includedRemainingCents: 0,
          purchasedRemainingCents: 0,
          openReservationsCents: 0,
          spendableCents: 0,
          grantResetsAt: "2026-09-17T12:00:00.000Z",
          purchasesFrozen: false,
        },
      })
    )
  );

  await page.route("**/api/billing/capacity/preview", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 2,
      effectiveAction: "increase",
    });
    await fulfillJson(route, {
      resource: "concurrency",
      lookupKey: "capacity_v2_concurrency_10_monthly",
      name: "Concurrency +10",
      action: "increase",
      currentQuantity: 1,
      resultingQuantity: 2,
      currentAllowance: "35",
      resultingAllowance: "45",
      currentRecurringAmountCents: 500,
      resultingRecurringAmountCents: 1_000,
      recurringChangeCents: 500,
      amountDueNowCents: 250,
      currency: "usd",
      taxStatus: "calculated",
      effectiveAt: "2026-08-17T12:00:00.000Z",
      effectiveTiming: "after_payment",
      previewToken: "preview-token",
      expiresAt: "2026-08-17T12:10:00.000Z",
    });
  });
  await page.route("**/api/billing/capacity/checkout", (route) =>
    fulfillJson(route, {
      status: "submitted",
      paymentUrl: null,
      entitlementStatus: "pending_webhook",
    })
  );
  await page.route("**/api/billing/hosted-usage/checkout", (route) =>
    fulfillJson(route, {
      status: "checkout_created",
      url: scopedPath("settings?tab=billing&billing=hosted-usage-submitted"),
      creditCents: 1_000,
      subtotalCents: 1_000,
      currency: "usd",
      balanceStatus: "pending_webhook",
    })
  );

  await page.goto(scopedPath("settings?tab=billing"));

  await expect(page.getByRole("heading", { name: "Plus" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Add inference credit" })
  ).toBeVisible();
  const creditChoices = page.getByRole("group", {
    name: "Choose credit amount",
  });
  await expect(creditChoices.getByRole("button")).toHaveCount(6);
  await expect(page.getByText("Inference", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Storage" })).toBeVisible();
  await expect(page.getByText("Hosted usage", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Retained data", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Not enforced", { exact: true })).toHaveCount(2);
  const headings = await page.locator("h2").allTextContents();
  expect(headings.indexOf("Add inference credit")).toBeLessThan(
    headings.indexOf("Plus")
  );
  await expect(page.getByText("7 of 35")).toBeVisible();
  await expect(page.getByText("2.3 GB of 5 GB")).toBeVisible();
  const inferenceValue = page.getByText("$0.00 available");
  await expect(inferenceValue).toBeVisible();
  await expect(page.getByText("At limit", { exact: true })).toHaveCount(1);
  expect((await inferenceValue.boundingBox())?.height).toBeLessThan(40);
  await expect(page.getByText("Run customer report")).toBeVisible();

  const inferenceCheckout = page.waitForRequest(
    "**/api/billing/hosted-usage/checkout"
  );
  await page.getByRole("button", { name: "Add $10 inference credit" }).click();
  expect((await inferenceCheckout).postDataJSON()).toMatchObject({
    preset: "capacity_v2_hosted_usage_credit_10",
  });
  await expect(
    page.getByText(
      "Payment submitted. Capacity updates after Stripe confirms the event."
    )
  ).toBeVisible();

  await page.getByRole("button", { name: "Manage Concurrency +10" }).click();
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await page.getByRole("button", { name: "Review change" }).click();
  await expect(page.getByText("35 to 45")).toBeVisible();
  await expect(page.getByText("$2.50")).toBeVisible();

  const confirmRequest = page.waitForRequest(
    "**/api/billing/capacity/checkout"
  );
  await page.getByRole("button", { name: "Confirm change" }).click();
  expect((await confirmRequest).postDataJSON()).toMatchObject({
    previewToken: "preview-token",
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("company Billing stays visible and read-only for a member", async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders("00000000-0000-4000-8000-000000000001"),
    "x-mogplex-scope-kind": "team",
    "x-mogplex-scope-slug": TEAM_SLUG,
    "x-mogplex-scope-id": TEAM_ID,
  });
  await mockSettingsShell(page);
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) =>
    fulfillJson(route, {
      team: { id: TEAM_ID, slug: TEAM_SLUG, name: "Acme", icon_url: null },
      members: [],
      invites: [],
      viewer: { userId: "member-1", role: "developer", canManage: false },
    })
  );
  await page.route(`**/api/teams/${TEAM_ID}/keys`, (route) =>
    fulfillJson(route, {
      keys: [],
      viewer: { role: "developer", canManage: false },
    })
  );
  await page.route(`**/api/teams/${TEAM_ID}/models`, (route) =>
    fulfillJson(route, {
      modelAllowlist: null,
      viewer: { role: "developer", canManage: false },
    })
  );
  await page.route("**/api/billing/capacity", (route) =>
    fulfillJson(
      route,
      capacitySummary({
        account: {
          id: "billing-account-2",
          eventSequence: "4",
          enforcementMode: "shadow",
          scope: "team",
          displayName: "Acme",
          status: "read_only",
          canManageBilling: false,
          hasSubscription: true,
          hasBillingHistory: true,
        },
        plan: {
          ref: "business",
          name: "Business",
          offerKind: "contract",
          interval: "contract",
          recurringAmountCents: null,
          renewsAt: null,
          cancelsAt: null,
          namedUserLimit: null,
        },
      })
    )
  );

  await page.goto(`/${TEAM_SLUG}/settings?tab=billing`);

  await expect(page.getByRole("heading", { name: "Business" })).toBeVisible();
  await expect(
    page.getByText("Ask a company owner or admin to change billing.")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Add|Manage/ })).toHaveCount(0);
});

test("Billing explains when purchase operations are unavailable", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);
  await page.route("**/api/billing/capacity", (route) =>
    fulfillJson(
      route,
      capacitySummary({
        billingOperationsEnabled: false,
      })
    )
  );

  await page.goto(scopedPath("settings?tab=billing"));

  await expect(
    page.getByText(
      "Inference purchases are unavailable on this deployment. Ask the deployment administrator to configure billing."
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      "Capacity purchases are unavailable on this deployment. Ask the deployment administrator to configure billing."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "$10", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add Storage +1 GB" })
  ).toHaveCount(0);
});

test("legacy subscribers can manage their plan and buy inference credit", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);
  await page.route("**/api/billing/capacity", (route) =>
    fulfillJson(
      route,
      capacitySummary({
        billingOperationsEnabled: false,
        plan: {
          ref: "legacy",
          name: "Mog Mode",
          offerKind: "legacy",
          interval: "contract",
          recurringAmountCents: null,
          renewsAt: "2026-09-17T12:00:00.000Z",
          cancelsAt: null,
          namedUserLimit: null,
        },
      })
    )
  );
  await page.route("**/api/stripe/checkout", (route) =>
    fulfillJson(route, {
      url: scopedPath("settings?tab=billing&billing=topup"),
    })
  );

  await page.goto(scopedPath("settings?tab=billing"));

  await expect(page.getByRole("heading", { name: "Mog Mode" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Plan and invoices" })
  ).toBeEnabled();

  const topupCheckout = page.waitForRequest("**/api/stripe/checkout");
  await page.getByRole("button", { name: "Add $10 inference credit" }).click();
  expect((await topupCheckout).postDataJSON()).toMatchObject({
    kind: "topup",
    preset: "topup_10",
  });
});

test("top-up customers can open billing history without a subscription", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);
  await page.route("**/api/billing/capacity", (route) =>
    fulfillJson(
      route,
      capacitySummary({
        account: {
          ...capacitySummary().account,
          hasSubscription: false,
          hasBillingHistory: true,
        },
      })
    )
  );
  await page.route("**/api/stripe/portal", (route) =>
    fulfillJson(route, { url: scopedPath("settings?tab=billing") })
  );

  await page.goto(scopedPath("settings?tab=billing"));

  const portalRequest = page.waitForRequest("**/api/stripe/portal");
  await page.getByRole("button", { name: "Billing history" }).click();
  await portalRequest;
});
