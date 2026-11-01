import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import * as Sentry from "@sentry/nextjs";
import type { BillingAccount } from "../../lib/billing/accounts";
import { installInMemorySentry } from "../support/sentry-capture";

let capture: { events: Sentry.Event[] };

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
  } finally {
    console.error = originalError;
  }
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
