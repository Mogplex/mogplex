import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import * as Sentry from "@sentry/nextjs";
import type { BillingAccount } from "../../lib/billing/accounts";
import { installInMemorySentry } from "../support/sentry-capture";

let capture: ReturnType<typeof installInMemorySentry>;

before(() => {
  capture = installInMemorySentry();
});
after(async () => {
  await Sentry.close();
});
beforeEach(() => {
  capture.events.length = 0;
});

const account: BillingAccount = {
  id: "account-1",
  owner_type: "user",
  owner_user_id: "user-1",
  product_team_id: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  tier: "free",
  period_anchor: null,
  subscription_checkout_generation: 0,
  status: "active",
  plan_code: null,
};

async function planCheckoutHandler(
  createIndividualPlanCheckout: () => Promise<never>
) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { createIndividualPlanCheckoutPostHandler } =
    await import("../../app/api/billing/capacity/plan/checkout/route");
  return createIndividualPlanCheckoutPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => ({
      ok: true as const,
      scope: {
        kind: "personal" as const,
        userId: "user-1",
        productTeamId: null,
      },
    }),
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => account,
    getActorEmail: async () => null,
    createIndividualPlanCheckout,
  });
}

function checkoutRequest() {
  return new Request("https://example.com/api/billing/capacity/plan/checkout", {
    method: "POST",
    body: JSON.stringify({ planCode: "pro", interval: "month" }),
  });
}

test("a provider failure in plan checkout reaches Sentry, not just the log", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const POST = await planCheckoutHandler(async () => {
      throw new Error(
        "Invalid line_items[0]: the product tax code is missing."
      );
    });
    const response = await POST(checkoutRequest());
    await Sentry.flush();
    assert.equal(response.status, 500);
    assert.equal(capture.events.length, 1);
    assert.equal(capture.events[0]?.tags?.billing_surface, "plan_checkout");
    assert.deepEqual(capture.events[0]?.extra, {
      scope: "personal",
      accountId: account.id,
    });
  } finally {
    console.error = originalError;
  }
});

test("a typed provider anomaly in plan checkout is reported", async () => {
  const { CapacityPlanCheckoutError } =
    await import("../../lib/billing/capacity-plan-checkout");
  const POST = await planCheckoutHandler(async () => {
    throw new CapacityPlanCheckoutError(
      "This Checkout session can no longer be used.",
      503,
      "checkout_session_unavailable"
    );
  });
  const response = await POST(checkoutRequest());
  await Sentry.flush();
  assert.equal(response.status, 503);
  assert.equal(capture.events.length, 1);
  assert.equal(capture.events[0]?.tags?.billing_surface, "plan_checkout");
  assert.equal(capture.events[0]?.extra?.accountId, account.id);
});

test("an expected plan checkout refusal is not reported", async () => {
  const { CapacityPlanCheckoutError } =
    await import("../../lib/billing/capacity-plan-checkout");
  const POST = await planCheckoutHandler(async () => {
    throw new CapacityPlanCheckoutError(
      "Individual plan checkout is not available for company workspaces.",
      409,
      "self_service_unavailable"
    );
  });
  const response = await POST(checkoutRequest());
  await Sentry.flush();
  assert.equal(response.status, 409);
  assert.equal(capture.events.length, 0);
});

const ATTEMPT_ID = "0198f3e8-9c41-4d40-8cb9-4afdfac76f01";
const personalScope = {
  ok: true as const,
  scope: { kind: "personal" as const, userId: "user-1", productTeamId: null },
};
const accountFailure = async (): Promise<never> => {
  throw new Error("database unavailable");
};
const signedIn = {
  requireUserId: async () => "user-1",
  resolveProductResourceScope: async () => personalScope,
  getOrCreateBillingAccount: accountFailure,
};

function post(path: string, body: unknown) {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const routeCases: Array<{
  surface: string;
  run: () => Promise<Response>;
}> = [
  {
    surface: "capacity_summary",
    run: async () => {
      const { createCapacityBillingSummaryGetHandler } =
        await import("../../app/api/billing/capacity/route");
      return createCapacityBillingSummaryGetHandler(signedIn)(
        new Request("https://example.com/api/billing/capacity")
      );
    },
  },
  {
    surface: "capacity_preview",
    run: async () => {
      const { createCapacityPreviewPostHandler } =
        await import("../../app/api/billing/capacity/preview/route");
      return createCapacityPreviewPostHandler({
        ...signedIn,
        capacityBillingOperationsEnabled: () => true,
      })(
        post("/api/billing/capacity/preview", {
          lookupKey: "capacity_v2_concurrency_10_monthly",
          quantity: 1,
          effectiveAction: "increase",
        })
      );
    },
  },
  {
    surface: "capacity_checkout",
    run: async () => {
      const { createCapacityCheckoutPostHandler } =
        await import("../../app/api/billing/capacity/checkout/route");
      return createCapacityCheckoutPostHandler({
        ...signedIn,
        capacityBillingOperationsEnabled: () => true,
      })(
        post("/api/billing/capacity/checkout", {
          previewToken: "signed-preview",
          attemptId: ATTEMPT_ID,
        })
      );
    },
  },
  {
    surface: "capacity_schedule",
    run: async () => {
      const { createCapacitySchedulePostHandler } =
        await import("../../app/api/billing/capacity/schedule/route");
      return createCapacitySchedulePostHandler({
        ...signedIn,
        capacityBillingOperationsEnabled: () => true,
      })(
        post("/api/billing/capacity/schedule", {
          previewToken: "signed-preview",
          attemptId: ATTEMPT_ID,
        })
      );
    },
  },
  {
    surface: "hosted_usage_checkout",
    run: async () => {
      const { createHostedUsageCheckoutPostHandler } =
        await import("../../app/api/billing/hosted-usage/checkout/route");
      return createHostedUsageCheckoutPostHandler({
        ...signedIn,
        capacityBillingOperationsEnabled: () => true,
        getActorEmail: async () => null,
      })(
        post("/api/billing/hosted-usage/checkout", {
          preset: "capacity_v2_hosted_usage_credit_25",
          attemptId: ATTEMPT_ID,
          returnPath: "/personal/settings?tab=billing",
        })
      );
    },
  },
  {
    surface: "capacity_events_account",
    run: async () => {
      const { createBillingAccountEventsGetHandler } =
        await import("../../app/api/billing/capacity/events/route");
      return createBillingAccountEventsGetHandler(signedIn)(
        new Request("https://example.com/api/billing/capacity/events")
      );
    },
  },
  {
    surface: "stripe_catalog_sync",
    run: async () => {
      const { createCapacityStripeCatalogPostHandler } =
        await import("../../app/api/cron/capacity-stripe-catalog/route");
      return createCapacityStripeCatalogPostHandler({
        requireMachineApiAuth: () => null,
        capacityBillingStripeMode: () => "live",
        syncCatalog: accountFailure,
      })(post("/api/cron/capacity-stripe-catalog", {}));
    },
  },
];

function routeReportsUnderItsSurface({
  surface,
  run,
}: (typeof routeCases)[number]) {
  test(`a caught failure in ${surface} is reported under its own surface`, async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
    const originalError = console.error;
    console.error = () => {};
    try {
      const response = await run();
      await Sentry.flush();
      assert.equal(response.status, 500);
      assert.equal(capture.events.length, 1);
      assert.equal(capture.events[0]?.tags?.billing_surface, surface);
      if (surface !== "stripe_catalog_sync") {
        assert.equal(capture.events[0]?.extra?.scope, "personal");
      }
    } finally {
      console.error = originalError;
    }
  });
}

for (const routeCase of routeCases) routeReportsUnderItsSurface(routeCase);
