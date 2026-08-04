import { expect, test } from "@playwright/test";
import {
  buildE2EAuthHeaders,
  enableScopedE2EAuth,
  scopedPath,
} from "./helpers/auth";
import type { Page, Route } from "@playwright/test";

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
}

test("billing is a first-class personal Settings tab with live checkout actions", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);
  await page.route("**/api/billing", (route) =>
    fulfillJson(route, {
      enabled: true,
      canManageBilling: true,
      tier: "free",
      status: "active",
      hasSubscription: false,
      hasStripeCustomer: false,
      balance: {
        includedCents: 0,
        purchasedCents: 2500,
        totalCents: 2500,
      },
    })
  );

  const checkoutBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/stripe/checkout", async (route) => {
    checkoutBodies.push(
      JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>
    );
    await fulfillJson(route, { url: "about:blank" });
  });

  await page.goto(scopedPath("settings?tab=billing"));

  await expect(page.getByRole("tab", { name: "Billing" })).toHaveAttribute(
    "data-state",
    "active"
  );
  await expect(page.getByText("$25.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add $10.00" })).toBeVisible();

  await page.getByRole("button", { name: "Add $10.00" }).click();
  await expect.poll(() => checkoutBodies.length).toBe(1);
  expect(checkoutBodies[0]).toMatchObject({
    kind: "topup",
    preset: "topup_10",
    returnPath: scopedPath("settings?tab=billing"),
  });
  expect(checkoutBodies[0]?.attemptId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

test("subscription checkout and existing-plan portal preserve the Billing tab return path", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);

  let billingSummary = {
    enabled: true,
    canManageBilling: true,
    tier: "free",
    status: "active",
    hasSubscription: false,
    hasStripeCustomer: false,
    balance: {
      includedCents: 0,
      purchasedCents: 0,
      totalCents: 0,
    },
  };
  await page.route("**/api/billing", (route) =>
    fulfillJson(route, billingSummary)
  );

  const checkoutBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/stripe/checkout", async (route) => {
    checkoutBodies.push(
      JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>
    );
    await fulfillJson(route, { url: "about:blank" });
  });

  await page.goto(scopedPath("settings?tab=billing"));
  await page.getByRole("button", { name: "Pro $20.00/mo" }).click();
  await expect.poll(() => checkoutBodies.length).toBe(1);
  expect(checkoutBodies[0]).toEqual({
    kind: "subscribe",
    plan: "pro_monthly",
    returnPath: scopedPath("settings?tab=billing"),
  });

  billingSummary = {
    ...billingSummary,
    tier: "pro",
    hasSubscription: true,
    hasStripeCustomer: true,
    balance: {
      includedCents: 2000,
      purchasedCents: 0,
      totalCents: 2000,
    },
  };
  const portalBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/stripe/portal", async (route) => {
    portalBodies.push(
      JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>
    );
    await fulfillJson(route, { url: "about:blank" });
  });

  await page.goto(scopedPath("settings?tab=billing"));
  await page.getByRole("button", { name: "Manage plan" }).click();
  await expect.poll(() => portalBodies.length).toBe(1);
  expect(portalBodies[0]).toEqual({
    returnPath: scopedPath("settings?tab=billing"),
  });
});

test("team members get a read-only billing surface", async ({ page }) => {
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
  await page.route("**/api/billing", (route) =>
    fulfillJson(route, {
      enabled: true,
      canManageBilling: false,
      tier: "team",
      status: "active",
      hasSubscription: true,
      hasStripeCustomer: true,
      balance: {
        includedCents: 8500,
        purchasedCents: 1000,
        totalCents: 9500,
      },
    })
  );

  await page.goto(`/${TEAM_SLUG}/settings?tab=billing`);

  await expect(page.getByRole("tab", { name: "Billing" })).toHaveAttribute(
    "data-state",
    "active"
  );
  await expect(
    page.getByText("Only a team owner or admin can change this plan.")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage plan" })).toHaveCount(
    0
  );
  await expect(page.getByRole("button", { name: /Add \$/ })).toHaveCount(0);
});

test("frozen top-ups stay disabled with an actionable message", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);
  await page.route("**/api/billing", (route) =>
    fulfillJson(route, {
      enabled: true,
      canManageBilling: true,
      tier: "free",
      status: "frozen_topups",
      hasSubscription: false,
      hasStripeCustomer: true,
      balance: {
        includedCents: 0,
        purchasedCents: 1000,
        totalCents: 1000,
      },
    })
  );

  await page.goto(scopedPath("settings?tab=billing"));

  await expect(page.getByRole("button", { name: "Add $10.00" })).toBeDisabled();
  await expect(
    page.getByText(
      "Top-ups are paused for this account. Contact support for help."
    )
  ).toBeVisible();
});
