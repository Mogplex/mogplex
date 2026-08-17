import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { BillingAccount } from "./accounts";
import {
  assertCapacityHostedUsagePayment,
  handleCapacityHostedUsagePaymentIfApplicable,
  stampedUsagePurchaseCents,
  type CapacityHostedUsageWebhookDeps,
} from "./capacity-hosted-usage-webhook";

const ATTEMPT_ID = "0198f3e8-9c41-4d40-8cb9-4afdfac76f01";

function account(): BillingAccount {
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
  };
}

function paymentIntent(
  overrides: Record<string, unknown> = {}
): Stripe.PaymentIntent {
  return {
    id: "pi-capacity",
    livemode: false,
    status: "succeeded",
    currency: "usd",
    amount_received: 2_500,
    metadata: {
      kind: "hosted_usage",
      catalog_version: "capacity_v2",
      billing_account_id: "account-1",
      credit_cents: "2500",
      checkout_attempt_id: ATTEMPT_ID,
    },
    ...overrides,
  } as unknown as Stripe.PaymentIntent;
}

function deps(
  overrides: Partial<CapacityHostedUsageWebhookDeps> = {}
): CapacityHostedUsageWebhookDeps {
  return {
    capacityBillingOperationsEnabled: () => true,
    findAccountById: async () => account(),
    postLedgerEntry: async () => ({ posted: true }),
    ...overrides,
  };
}

describe("capacity hosted-usage webhook", () => {
  it("ignores unrelated payments and credits a valid purchase once", async () => {
    await expect(
      handleCapacityHostedUsagePaymentIfApplicable({
        paymentIntent: paymentIntent({ metadata: {} }),
        deps: deps(),
      })
    ).resolves.toBe(false);

    const postLedgerEntry = vi.fn(async () => ({ posted: true }));
    await expect(
      handleCapacityHostedUsagePaymentIfApplicable({
        paymentIntent: paymentIntent(),
        deps: deps({ postLedgerEntry }),
      })
    ).resolves.toBe(true);
    expect(postLedgerEntry).toHaveBeenCalledWith({
      accountId: "account-1",
      deltaCents: 2_500,
      bucket: "purchased",
      kind: "topup",
      sourceRef: "hosted-usage:pi-capacity",
      metadata: {
        purchase_kind: "capacity",
        catalog_version: "capacity_v2",
        payment_intent: "pi-capacity",
        amount_received: 2_500,
      },
    });
  });

  it("rejects disabled, live, incomplete, or inconsistent payments", () => {
    expect(() =>
      assertCapacityHostedUsagePayment(
        paymentIntent(),
        deps({ capacityBillingOperationsEnabled: () => false })
      )
    ).toThrow(/operations are disabled/);

    for (const intent of [
      paymentIntent({ livemode: true }),
      paymentIntent({ status: "processing" }),
      paymentIntent({ currency: "cad" }),
      paymentIntent({ amount_received: 2_499 }),
      paymentIntent({ amount_received: Number.NaN }),
      paymentIntent({
        metadata: {
          ...paymentIntent().metadata,
          catalog_version: "capacity_v3",
        },
      }),
      paymentIntent({
        metadata: {
          ...paymentIntent().metadata,
          checkout_attempt_id: "invalid",
        },
      }),
      paymentIntent({
        metadata: { ...paymentIntent().metadata, credit_cents: "999" },
      }),
      paymentIntent({
        metadata: { ...paymentIntent().metadata, credit_cents: "100001" },
      }),
    ]) {
      expect(() => assertCapacityHostedUsagePayment(intent, deps())).toThrow(
        /does not match the capacity purchase contract/
      );
    }
  });

  it("requires a valid server-stamped credit amount", () => {
    expect(stampedUsagePurchaseCents(paymentIntent())).toBe(2_500);
    for (const creditCents of ["", "0", "1.5", "not-a-number"]) {
      expect(() =>
        stampedUsagePurchaseCents(
          paymentIntent({
            metadata: {
              ...paymentIntent().metadata,
              credit_cents: creditCents,
            },
          })
        )
      ).toThrow(/missing a valid credit_cents stamp/);
    }
  });

  it("keeps missing or unknown account links retryable", async () => {
    await expect(
      handleCapacityHostedUsagePaymentIfApplicable({
        paymentIntent: paymentIntent({
          metadata: {
            ...paymentIntent().metadata,
            billing_account_id: "",
          },
        }),
        deps: deps(),
      })
    ).rejects.toThrow(/missing its billing account/);

    await expect(
      handleCapacityHostedUsagePaymentIfApplicable({
        paymentIntent: paymentIntent(),
        deps: deps({ findAccountById: async () => null }),
      })
    ).rejects.toThrow(/unknown account/);
  });
});
