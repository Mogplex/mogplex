import assert from "node:assert/strict";
import type Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";
import type { BillingAccount } from "./accounts";
import {
  CapacityPlanCheckoutError,
  createIndividualPlanCheckout,
  individualPlanCheckoutIdempotencyKey,
  validateIndividualPlanCheckoutRequest,
  type IndividualPlanCheckoutDeps,
} from "./capacity-plan-checkout";

function accountFixture(
  overrides: Partial<BillingAccount> = {}
): BillingAccount {
  return {
    id: "account-1",
    owner_type: "user",
    owner_user_id: "user-1",
    product_team_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    tier: "free",
    period_anchor: null,
    subscription_checkout_generation: 3,
    status: "active",
    plan_code: null,
    ...overrides,
  };
}

function depsFixture(
  overrides: Partial<IndividualPlanCheckoutDeps> = {}
): IndividualPlanCheckoutDeps {
  return {
    capacityBillingOperationsEnabled: () => true,
    ensureCustomer: async () => "cus-1",
    resolvePriceId: async () => "price-plus-annual",
    createCheckoutSession: async () => ({
      id: "cs-1",
      url: "https://checkout.stripe.test/cs-1",
    }),
    appUrl: (path) => `https://mogplex.test${path}`,
    ...overrides,
  };
}

describe("Individual capacity plan checkout", () => {
  test("accepts only canonical Individual plan and interval choices", () => {
    assert.deepEqual(
      validateIndividualPlanCheckoutRequest({
        planCode: "plus",
        interval: "year",
        returnPath: "/personal/settings?tab=billing",
      }),
      {
        ok: true,
        value: {
          planCode: "plus",
          interval: "year",
          returnPath: "/personal/settings?tab=billing",
        },
      }
    );
    for (const body of [
      null,
      { planCode: "business", interval: "month" },
      { planCode: "enterprise", interval: "year" },
      { planCode: "capacity_v2_pro_monthly", interval: "month" },
      { planCode: "pro", interval: "week" },
      { planCode: "pro", interval: "month", priceId: "price_attacker" },
    ]) {
      assert.equal(validateIndividualPlanCheckoutRequest(body).ok, false);
    }
  });

  test("uses a generation-scoped key so retries cannot create another subscription", () => {
    assert.equal(
      individualPlanCheckoutIdempotencyKey(accountFixture()),
      "capacity-plan-subscribe:account-1:3"
    );
  });

  test("creates exactly one canonical plan item and waits for the paid webhook", async () => {
    let checkout:
      | {
          params: Stripe.Checkout.SessionCreateParams;
          options: Stripe.RequestOptions;
        }
      | undefined;
    const ensureCustomer = vi.fn(async () => "cus-1");
    const resolvePriceId = vi.fn(async () => "price-plus-annual");

    const result = await createIndividualPlanCheckout({
      account: accountFixture(),
      actorEmail: "owner@example.com",
      request: {
        planCode: "plus",
        interval: "year",
        returnPath: "/personal/settings?tab=billing",
      },
      deps: depsFixture({
        ensureCustomer,
        resolvePriceId,
        createCheckoutSession: async (params, options) => {
          checkout = { params, options };
          return {
            id: "cs-1",
            url: "https://checkout.stripe.test/cs-1",
          };
        },
      }),
    });

    expect(result).toEqual({
      status: "checkout_created",
      url: "https://checkout.stripe.test/cs-1",
      plan: {
        code: "plus",
        name: "Plus",
        interval: "year",
        amountCents: 102_000,
        currency: "usd",
        maxNamedUsers: 1,
      },
      entitlementStatus: "pending_webhook",
    });
    expect(resolvePriceId).toHaveBeenCalledWith("capacity_v2_plus_annual");
    expect(ensureCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "account-1" }),
      "owner@example.com"
    );
    expect(checkout?.params).toMatchObject({
      mode: "subscription",
      customer: "cus-1",
      client_reference_id: "account-1",
      line_items: [{ price: "price-plus-annual", quantity: 1 }],
      managed_payments: { enabled: true },
      billing_address_collection: "auto",
      metadata: {
        kind: "individual_plan",
        catalog_version: "capacity_v2",
        billing_account_id: "account-1",
        plan_code: "plus",
        plan_interval: "year",
        price_lookup_key: "capacity_v2_plus_annual",
        max_named_users: "1",
      },
      subscription_data: {
        metadata: {
          kind: "individual_plan",
          catalog_version: "capacity_v2",
          billing_account_id: "account-1",
          plan_code: "plus",
          plan_interval: "year",
          price_lookup_key: "capacity_v2_plus_annual",
          max_named_users: "1",
        },
      },
      success_url:
        "https://mogplex.test/personal/settings?tab=billing&billing=plan-submitted",
      cancel_url:
        "https://mogplex.test/personal/settings?tab=billing&billing=cancelled",
    });
    expect(checkout?.params.allow_promotion_codes).toBeUndefined();
    expect(checkout?.params.automatic_tax).toBeUndefined();
    expect(checkout?.options.idempotencyKey).toBe(
      "capacity-plan-subscribe:account-1:3"
    );
  });

  test("resolves every monthly and annual plan from the canonical catalog", async () => {
    const cases = [
      ["pro", "month", "capacity_v2_pro_monthly", 2_000],
      ["pro", "year", "capacity_v2_pro_annual", 20_400],
      ["plus", "month", "capacity_v2_plus_monthly", 10_000],
      ["plus", "year", "capacity_v2_plus_annual", 102_000],
      ["max", "month", "capacity_v2_max_monthly", 20_000],
      ["max", "year", "capacity_v2_max_annual", 204_000],
    ] as const;
    for (const [planCode, interval, lookupKey, amountCents] of cases) {
      let resolvedLookupKey: string | undefined;
      const result = await createIndividualPlanCheckout({
        account: accountFixture(),
        actorEmail: null,
        request: { planCode, interval, returnPath: "/" },
        deps: depsFixture({
          resolvePriceId: async (value) => {
            resolvedLookupKey = value;
            return `price-${planCode}-${interval}`;
          },
        }),
      });
      expect(resolvedLookupKey).toBe(lookupKey);
      expect(result.plan).toMatchObject({
        code: planCode,
        interval,
        amountCents,
        maxNamedUsers: 1,
      });
    }
  });

  test("rejects team ownership and any existing subscription before Stripe access", async () => {
    const touched = vi.fn(async () => "should-not-run");
    for (const target of [
      accountFixture({
        owner_type: "team",
        owner_user_id: null,
        product_team_id: "team-1",
      }),
      accountFixture({ tier: "pro" }),
      accountFixture({ stripe_subscription_id: "sub-existing" }),
      accountFixture({ plan_code: "pro" }),
    ]) {
      await expect(
        createIndividualPlanCheckout({
          account: target,
          actorEmail: null,
          request: {
            planCode: "pro",
            interval: "month",
            returnPath: "/",
          },
          deps: depsFixture({
            ensureCustomer: touched,
            resolvePriceId: touched,
          }),
        })
      ).rejects.toBeInstanceOf(CapacityPlanCheckoutError);
    }
    expect(touched).not.toHaveBeenCalled();
  });

  test("fails closed for disabled operations, account state, and stale sessions", async () => {
    const cases: Array<{
      account?: BillingAccount;
      deps: IndividualPlanCheckoutDeps;
      code: string;
    }> = [
      {
        deps: depsFixture({ capacityBillingOperationsEnabled: () => false }),
        code: "operations_disabled",
      },
      {
        account: accountFixture({ status: "past_due" }),
        deps: depsFixture(),
        code: "account_inactive",
      },
      {
        account: accountFixture({ status: "frozen_topups" }),
        deps: depsFixture(),
        code: "purchases_frozen",
      },
      {
        deps: depsFixture({
          createCheckoutSession: async () => ({ id: "cs-used", url: null }),
        }),
        code: "checkout_session_unavailable",
      },
    ];
    for (const item of cases) {
      await expect(
        createIndividualPlanCheckout({
          account: item.account ?? accountFixture(),
          actorEmail: null,
          request: {
            planCode: "pro",
            interval: "month",
            returnPath: "/",
          },
          deps: item.deps,
        })
      ).rejects.toMatchObject({ code: item.code });
    }
  });

  test("validates direct service input and sanitizes return paths", async () => {
    const ensureCustomer = vi.fn(async () => "cus-1");
    await expect(
      createIndividualPlanCheckout({
        account: accountFixture(),
        actorEmail: null,
        request: {
          planCode: "business" as "pro",
          interval: "month",
          returnPath: "/",
        },
        deps: depsFixture({ ensureCustomer }),
      })
    ).rejects.toMatchObject({ code: "invalid_plan" });
    expect(ensureCustomer).not.toHaveBeenCalled();

    let successUrl: string | undefined;
    await createIndividualPlanCheckout({
      account: accountFixture(),
      actorEmail: null,
      request: {
        planCode: "pro",
        interval: "month",
        returnPath: "https://attacker.example/steal",
      },
      deps: depsFixture({
        createCheckoutSession: async (params) => {
          successUrl = params.success_url;
          return { id: "cs-safe", url: "https://stripe.test/safe" };
        },
      }),
    });
    expect(successUrl).toBe("https://mogplex.test/?billing=plan-submitted");
  });
});
