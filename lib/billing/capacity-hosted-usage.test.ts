import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { BillingAccount } from "./accounts";
import { resolveCatalogPriceId } from "./stripe-checkout";
import {
  createHostedUsageCheckout,
  hostedUsageCheckoutIdempotencyKey,
  resolveCapacityHostedUsageProductId,
  validateHostedUsageCheckoutRequest,
  type CapacityHostedUsageProductDeps,
  type HostedUsageCheckoutDeps,
} from "./capacity-hosted-usage";

const ATTEMPT_ID = "0198f3e8-9c41-4d40-8cb9-4afdfac76f01";

function account(overrides: Partial<BillingAccount> = {}): BillingAccount {
  return {
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
    ...overrides,
  };
}

function checkoutDeps(
  overrides: Partial<HostedUsageCheckoutDeps> = {}
): HostedUsageCheckoutDeps {
  return {
    capacityBillingOperationsEnabled: () => true,
    ensureCustomer: async () => "cus-1",
    resolvePriceId: async () => "price-hosted-usage",
    resolveProductId: async () => "prod-hosted-usage",
    createCheckoutSession: async () => ({
      id: "cs-1",
      url: "https://checkout.stripe.test/cs-1",
    }),
    appUrl: (path) => `https://mogplex.test${path}`,
    ...overrides,
  };
}

describe("hosted-usage checkout request", () => {
  it("accepts one canonical preset or one bounded custom amount", () => {
    expect(
      validateHostedUsageCheckoutRequest({
        preset: "capacity_v2_hosted_usage_credit_25",
        attemptId: ATTEMPT_ID,
        returnPath: "/personal/settings?tab=billing",
      })
    ).toEqual({
      ok: true,
      value: {
        preset: "capacity_v2_hosted_usage_credit_25",
        attemptId: ATTEMPT_ID,
        returnPath: "/personal/settings?tab=billing",
      },
    });
    expect(
      validateHostedUsageCheckoutRequest({
        amountCents: 1_000,
        attemptId: ATTEMPT_ID,
        returnPath: "https://other.example",
      })
    ).toEqual({
      ok: true,
      value: {
        amountCents: 1_000,
        attemptId: ATTEMPT_ID,
        returnPath: "/",
      },
    });
  });

  it("rejects ambiguous, legacy, malformed, and out-of-range amounts", () => {
    for (const body of [
      null,
      { attemptId: ATTEMPT_ID },
      {
        preset: "capacity_v2_hosted_usage_credit_25",
        amountCents: 2_500,
        attemptId: ATTEMPT_ID,
      },
      { preset: "topup_25", attemptId: ATTEMPT_ID },
      { amountCents: 999, attemptId: ATTEMPT_ID },
      { amountCents: 100_001, attemptId: ATTEMPT_ID },
      { amountCents: 1_000.5, attemptId: ATTEMPT_ID },
      { amountCents: 1_000, attemptId: "not-a-uuid" },
    ]) {
      expect(validateHostedUsageCheckoutRequest(body).ok).toBe(false);
    }
  });
});

describe("hosted-usage Stripe product lookup", () => {
  it("walks all products and caches the canonical result", async () => {
    let calls = 0;
    const deps: CapacityHostedUsageProductDeps = {
      async *listProducts() {
        calls += 1;
        yield {
          id: "prod-other",
          active: true,
          metadata: {} as Record<string, string>,
        };
        yield {
          id: "prod-hosted-usage",
          active: true,
          metadata: {
            mogplex_catalog_key: "capacity_v2_hosted_usage",
          },
        };
      },
    };
    await expect(resolveCapacityHostedUsageProductId(deps)).resolves.toBe(
      "prod-hosted-usage"
    );
    await expect(resolveCapacityHostedUsageProductId(deps)).resolves.toBe(
      "prod-hosted-usage"
    );
    expect(calls).toBe(1);
  });

  it("rejects missing or duplicate canonical products", async () => {
    await expect(
      resolveCapacityHostedUsageProductId({
        async *listProducts() {
          yield { id: "prod-other", active: true, metadata: {} };
        },
      })
    ).rejects.toThrow(/not seeded/);
    await expect(
      resolveCapacityHostedUsageProductId({
        async *listProducts() {
          for (const id of ["prod-1", "prod-2"]) {
            yield {
              id,
              active: true,
              metadata: {
                mogplex_catalog_key: "capacity_v2_hosted_usage",
              },
            };
          }
        },
      })
    ).rejects.toThrow(/duplicate/);
  });
});

describe("hosted-usage Checkout creation", () => {
  it("resolves canonical preset prices as one-time purchases", async () => {
    await expect(
      resolveCatalogPriceId("capacity_v2_hosted_usage_credit_25", async () => ({
        data: [
          {
            id: "price-hosted-usage",
            active: true,
            unit_amount: 2_500,
            currency: "usd",
            recurring: null,
          },
        ],
      }))
    ).resolves.toBe("price-hosted-usage");
  });

  it("creates a face-value preset purchase with server-owned metadata", async () => {
    let checkout:
      | {
          params: Stripe.Checkout.SessionCreateParams;
          options: Stripe.RequestOptions;
        }
      | undefined;
    const ensureCustomer = vi.fn(async () => "cus-1");
    const result = await createHostedUsageCheckout({
      account: account(),
      actorEmail: "owner@example.com",
      request: {
        preset: "capacity_v2_hosted_usage_credit_25",
        attemptId: ATTEMPT_ID,
        returnPath: "/personal/settings?tab=billing",
      },
      deps: checkoutDeps({
        ensureCustomer,
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
      creditCents: 2_500,
      subtotalCents: 2_500,
      currency: "usd",
      balanceStatus: "pending_webhook",
    });
    expect(ensureCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "account-1" }),
      "owner@example.com"
    );
    expect(checkout?.params).toMatchObject({
      mode: "payment",
      customer: "cus-1",
      client_reference_id: "account-1",
      line_items: [{ price: "price-hosted-usage", quantity: 1 }],
      managed_payments: { enabled: true },
      invoice_creation: { enabled: true },
      payment_intent_data: {
        metadata: {
          kind: "hosted_usage",
          catalog_version: "capacity_v2",
          billing_account_id: "account-1",
          credit_cents: "2500",
          checkout_attempt_id: ATTEMPT_ID,
        },
      },
      success_url:
        "https://mogplex.test/personal/settings?tab=billing&billing=hosted-usage-submitted",
      cancel_url:
        "https://mogplex.test/personal/settings?tab=billing&billing=cancelled",
    });
    expect(checkout?.params.allow_promotion_codes).toBeUndefined();
    expect(checkout?.params.automatic_tax).toBeUndefined();
    expect(checkout?.options.idempotencyKey).toBe(
      `capacity-hosted-usage:account-1:${ATTEMPT_ID}`
    );
  });

  it("uses the seeded product and server-owned amount for custom checkout", async () => {
    let lineItem: Stripe.Checkout.SessionCreateParams.LineItem | undefined;
    await createHostedUsageCheckout({
      account: account(),
      actorEmail: null,
      request: {
        amountCents: 1_337,
        attemptId: ATTEMPT_ID,
        returnPath: "/",
      },
      deps: checkoutDeps({
        createCheckoutSession: async (params) => {
          lineItem = params.line_items?.[0];
          return { id: "cs-custom", url: "https://stripe.test/custom" };
        },
      }),
    });
    expect(lineItem).toEqual({
      price_data: {
        currency: "usd",
        product: "prod-hosted-usage",
        unit_amount: 1_337,
      },
      quantity: 1,
    });
  });

  it("fails closed for the gate, company contracts, account state, and stale sessions", async () => {
    const cases: Array<{
      target: BillingAccount;
      deps: HostedUsageCheckoutDeps;
      code: string;
    }> = [
      {
        target: account(),
        deps: checkoutDeps({ capacityBillingOperationsEnabled: () => false }),
        code: "operations_disabled",
      },
      {
        target: account({ plan_code: "business" }),
        deps: checkoutDeps(),
        code: "self_service_unavailable",
      },
      {
        target: account({
          owner_type: "team",
          owner_user_id: null,
          product_team_id: "team-1",
        }),
        deps: checkoutDeps(),
        code: "self_service_unavailable",
      },
      {
        target: account({ status: "frozen_topups" }),
        deps: checkoutDeps(),
        code: "purchases_frozen",
      },
      {
        target: account({ status: "past_due" }),
        deps: checkoutDeps(),
        code: "account_inactive",
      },
      {
        target: account({ stripe_subscription_id: null }),
        deps: checkoutDeps(),
        code: "subscription_required",
      },
      {
        target: account(),
        deps: checkoutDeps({
          createCheckoutSession: async () => ({ id: "cs-used", url: null }),
        }),
        code: "checkout_session_unavailable",
      },
    ];
    for (const item of cases) {
      await expect(
        createHostedUsageCheckout({
          account: item.target,
          actorEmail: null,
          request: {
            amountCents: 1_000,
            attemptId: ATTEMPT_ID,
            returnPath: "/",
          },
          deps: item.deps,
        })
      ).rejects.toMatchObject({ code: item.code });
    }
  });

  it("validates direct service input before creating a customer", async () => {
    const ensureCustomer = vi.fn(async () => "cus-1");
    for (const request of [
      {
        amountCents: Number.NaN,
        attemptId: ATTEMPT_ID,
        returnPath: "/",
      },
      {
        preset: "capacity_v2_hosted_usage_credit_25",
        amountCents: 2_500,
        attemptId: ATTEMPT_ID,
        returnPath: "/",
      },
      {
        amountCents: 1_000,
        attemptId: "not-a-uuid",
        returnPath: "/",
      },
    ]) {
      await expect(
        createHostedUsageCheckout({
          account: account(),
          actorEmail: null,
          request,
          deps: checkoutDeps({ ensureCustomer }),
        })
      ).rejects.toBeDefined();
    }
    expect(ensureCustomer).not.toHaveBeenCalled();
  });

  it("sanitizes direct service return paths", async () => {
    let checkout: Stripe.Checkout.SessionCreateParams | undefined;
    await createHostedUsageCheckout({
      account: account(),
      actorEmail: null,
      request: {
        amountCents: 1_000,
        attemptId: ATTEMPT_ID,
        returnPath: "https://other.example/steal",
      },
      deps: checkoutDeps({
        createCheckoutSession: async (params) => {
          checkout = params;
          return { id: "cs-safe", url: "https://stripe.test/safe" };
        },
      }),
    });
    expect(checkout?.success_url).toBe(
      "https://mogplex.test/?billing=hosted-usage-submitted"
    );
    expect(checkout?.cancel_url).toBe(
      "https://mogplex.test/?billing=cancelled"
    );
  });

  it("builds stable idempotency scopes", () => {
    expect(hostedUsageCheckoutIdempotencyKey("account-1", ATTEMPT_ID)).toBe(
      `capacity-hosted-usage:account-1:${ATTEMPT_ID}`
    );
    expect(() => hostedUsageCheckoutIdempotencyKey("", ATTEMPT_ID)).toThrow(
      /Invalid/
    );
  });
});
