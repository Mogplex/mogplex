import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import type { BillingAccount } from "../../lib/billing/accounts";
import { CapacityChangeError } from "../../lib/billing/capacity-stripe-changes";

const ATTEMPT_ID = "0198f3e8-9c41-4d40-8cb9-4afdfac76f01";
const scopeResolution = {
  ok: true as const,
  scope: {
    kind: "personal" as const,
    userId: "user-1",
    productTeamId: null,
  },
};
const account: BillingAccount = {
  id: "account-1",
  owner_type: "user",
  owner_user_id: "user-1",
  product_team_id: null,
  stripe_customer_id: "cus-1",
  stripe_subscription_id: "sub-1",
  tier: "pro",
  plan_code: "pro",
  period_anchor: "2026-08-16",
  subscription_checkout_generation: 0,
  status: "active",
};

async function routes() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return Promise.all([
    import("../../app/api/billing/capacity/preview/route"),
    import("../../app/api/billing/capacity/checkout/route"),
  ]);
}

async function scheduleRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/billing/capacity/schedule/route");
}

test("capacity preview authenticates and requires billing.manage", async () => {
  const [{ createCapacityPreviewPostHandler }] = await routes();
  let scopeCalls = 0;
  const unauthenticated = createCapacityPreviewPostHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    resolveProductResourceScope: async () => {
      scopeCalls += 1;
      return scopeResolution;
    },
  });
  assert.equal(
    (
      await unauthenticated(
        new Request("https://example.com/api/billing/capacity/preview", {
          method: "POST",
        })
      )
    ).status,
    401
  );
  assert.equal(scopeCalls, 0);

  let requiredCapability: string | undefined;
  const forbidden = createCapacityPreviewPostHandler({
    requireUserId: async () => "viewer-1",
    resolveProductResourceScope: async (input) => {
      requiredCapability = input.requiredCapability;
      return { ok: false, status: 403, error: "Forbidden" };
    },
  });
  assert.equal(
    (
      await forbidden(
        new Request("https://example.com/api/billing/capacity/preview", {
          method: "POST",
        })
      )
    ).status,
    403
  );
  assert.equal(requiredCapability, "billing.manage");
});

test("capacity preview fails closed before account or Stripe access", async () => {
  const [{ createCapacityPreviewPostHandler }] = await routes();
  let touched = false;
  const handler = createCapacityPreviewPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => false,
    getOrCreateBillingAccount: async () => {
      touched = true;
      return account;
    },
    previewCapacityChange: async () => {
      touched = true;
      throw new Error("should not run");
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/capacity/preview", {
      method: "POST",
      body: JSON.stringify({
        lookupKey: "capacity_v2_concurrency_10_monthly",
        quantity: 1,
        effectiveAction: "increase",
      }),
    })
  );
  assert.equal(response.status, 503);
  assert.equal(touched, false);
});

test("capacity preview resolves the account and returns the service result", async () => {
  const [{ createCapacityPreviewPostHandler }] = await routes();
  let serviceInput: unknown;
  const handler = createCapacityPreviewPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => account,
    signingSecret: () => "secret",
    previewCapacityChange: async (input) => {
      serviceInput = input;
      return { previewToken: "signed-preview" } as never;
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/capacity/preview", {
      method: "POST",
      body: JSON.stringify({
        lookupKey: "capacity_v2_concurrency_10_monthly",
        quantity: 1,
        effectiveAction: "increase",
      }),
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { previewToken: "signed-preview" });
  assert.deepEqual(serviceInput, {
    account,
    request: {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 1,
      effectiveAction: "increase",
    },
    signingSecret: "secret",
  });
});

test("capacity checkout requires billing.manage and a valid attempt", async () => {
  const [, { createCapacityCheckoutPostHandler }] = await routes();
  let requiredCapability: string | undefined;
  const forbidden = createCapacityCheckoutPostHandler({
    requireUserId: async () => "viewer-1",
    resolveProductResourceScope: async (input) => {
      requiredCapability = input.requiredCapability;
      return { ok: false, status: 403, error: "Forbidden" };
    },
  });
  assert.equal(
    (
      await forbidden(
        new Request("https://example.com/api/billing/capacity/checkout", {
          method: "POST",
        })
      )
    ).status,
    403
  );
  assert.equal(requiredCapability, "billing.manage");

  const invalid = createCapacityCheckoutPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
  });
  assert.equal(
    (
      await invalid(
        new Request("https://example.com/api/billing/capacity/checkout", {
          method: "POST",
          body: JSON.stringify({ previewToken: "token", attemptId: "bad" }),
        })
      )
    ).status,
    400
  );
});

test("capacity checkout submits the signed preview through the account scope", async () => {
  const [, { createCapacityCheckoutPostHandler }] = await routes();
  let serviceInput: unknown;
  const handler = createCapacityCheckoutPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => account,
    signingSecret: () => "secret",
    confirmCapacityIncrease: async (input) => {
      serviceInput = input;
      return {
        status: "submitted",
        subscriptionId: "sub-1",
        invoiceId: "in-1",
        paymentUrl: null,
        paymentClientSecret: null,
        entitlementStatus: "pending_webhook",
      };
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/capacity/checkout", {
      method: "POST",
      body: JSON.stringify({
        previewToken: "signed-preview",
        attemptId: ATTEMPT_ID,
      }),
    })
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).entitlementStatus, "pending_webhook");
  assert.deepEqual(serviceInput, {
    account,
    previewToken: "signed-preview",
    attemptId: ATTEMPT_ID,
    signingSecret: "secret",
  });
});

test("capacity schedule requires billing.manage and fails closed before account access", async () => {
  const { createCapacitySchedulePostHandler } = await scheduleRoute();
  let requiredCapability: string | undefined;
  const forbidden = createCapacitySchedulePostHandler({
    requireUserId: async () => "viewer-1",
    resolveProductResourceScope: async (input) => {
      requiredCapability = input.requiredCapability;
      return { ok: false, status: 403, error: "Forbidden" };
    },
  });
  assert.equal(
    (
      await forbidden(
        new Request("https://example.com/api/billing/capacity/schedule", {
          method: "POST",
        })
      )
    ).status,
    403
  );
  assert.equal(requiredCapability, "billing.manage");

  let touched = false;
  const disabled = createCapacitySchedulePostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => false,
    getOrCreateBillingAccount: async () => {
      touched = true;
      return account;
    },
    scheduleCapacityDecrease: async () => {
      touched = true;
      throw new Error("should not run");
    },
  });
  const response = await disabled(
    new Request("https://example.com/api/billing/capacity/schedule", {
      method: "POST",
      body: JSON.stringify({
        previewToken: "signed-preview",
        attemptId: ATTEMPT_ID,
      }),
    })
  );
  assert.equal(response.status, 503);
  assert.equal(touched, false);
});

test("capacity schedule submits the signed preview through the account scope", async () => {
  const { createCapacitySchedulePostHandler } = await scheduleRoute();
  let serviceInput: unknown;
  const handler = createCapacitySchedulePostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => account,
    signingSecret: () => "secret",
    scheduleCapacityDecrease: async (input) => {
      serviceInput = input;
      return {
        status: "scheduled",
        subscriptionId: "sub-1",
        scheduleId: "sub_sched-1",
        action: "decrease",
        resultingQuantity: 1,
        effectiveAt: "2026-09-16T00:00:00.000Z",
        prorationBehavior: "none",
        entitlementStatus: "pending_webhook",
      };
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/capacity/schedule", {
      method: "POST",
      body: JSON.stringify({
        previewToken: "signed-preview",
        attemptId: ATTEMPT_ID,
      }),
    })
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "scheduled");
  assert.deepEqual(serviceInput, {
    account,
    previewToken: "signed-preview",
    attemptId: ATTEMPT_ID,
    signingSecret: "secret",
  });
});

test("capacity routes preserve safe service error codes", async () => {
  const [{ createCapacityPreviewPostHandler }] = await routes();
  const handler = createCapacityPreviewPostHandler({
    requireUserId: async () => "user-1",
    resolveProductResourceScope: async () => scopeResolution,
    capacityBillingOperationsEnabled: () => true,
    getOrCreateBillingAccount: async () => account,
    previewCapacityChange: async () => {
      throw new CapacityChangeError(
        "Another capacity change is waiting for payment",
        409,
        "change_pending"
      );
    },
  });
  const response = await handler(
    new Request("https://example.com/api/billing/capacity/preview", {
      method: "POST",
      body: JSON.stringify({
        lookupKey: "capacity_v2_concurrency_10_monthly",
        quantity: 1,
        effectiveAction: "increase",
      }),
    })
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Another capacity change is waiting for payment",
    code: "change_pending",
  });
});
