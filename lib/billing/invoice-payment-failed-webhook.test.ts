import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingAccount } from "@/lib/billing/accounts";
import type { PaymentFailedEmailParams } from "@/lib/email/send-payment-failed";
import {
  handleInvoicePaymentFailed,
  type InvoicePaymentFailedDeps,
} from "./invoice-payment-failed-webhook";

const EVENT = {
  id: "evt_1",
  created: Date.parse("2026-08-04T18:00:00.000Z") / 1000,
};

function account(overrides: Partial<BillingAccount> = {}): BillingAccount {
  return {
    id: "acct-1",
    owner_type: "user",
    owner_user_id: "user-1",
    product_team_id: null,
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    tier: "pro",
    period_anchor: null,
    subscription_checkout_generation: 0,
    status: "active",
    ...overrides,
  };
}

function invoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: "in_1",
    customer: "cus_1",
    status: "open",
    customer_email: "billing@example.com",
    hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
    amount_remaining: 2000,
    currency: "usd",
    next_payment_attempt: Date.parse("2026-08-07T00:00:00.000Z") / 1000,
    ...overrides,
  } as Stripe.Invoice;
}

function harness(
  options: {
    account?: BillingAccount | null;
    current?: Stripe.Invoice;
    sendOk?: boolean;
  } = {}
) {
  const updates: Array<{ id: string; status: unknown }> = [];
  const emails: PaymentFailedEmailParams[] = [];
  const deps: InvoicePaymentFailedDeps = {
    findAccountByCustomer: async () =>
      options.account === undefined ? account() : options.account,
    updateAccount: async (id, patch) => {
      updates.push({ id, status: patch.status });
    },
    retrieveInvoice: async () => options.current ?? invoice(),
    sendPaymentFailedEmail: async (params) => {
      emails.push(params);
      return options.sendOk === false
        ? { ok: false, reason: "resend_error" }
        : { ok: true, channel: "resend" };
    },
  };
  return { deps, updates, emails };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleInvoicePaymentFailed", () => {
  it("should mark past_due and email the billing contact", async () => {
    const { deps, updates, emails } = harness();

    await handleInvoicePaymentFailed(invoice(), EVENT, deps);

    expect(updates).toEqual([{ id: "acct-1", status: "past_due" }]);
    expect(emails).toEqual([
      {
        email: "billing@example.com",
        amountCents: 2000,
        currency: "usd",
        nextAttemptAt: new Date("2026-08-07T00:00:00.000Z"),
        payUrl: "https://invoice.stripe.com/i/in_1",
        idempotencyKey: "invoice-payment-failed/evt_1",
      },
    ]);
  });

  it("should ignore invoices for customers without a billing account", async () => {
    const { deps, updates, emails } = harness({ account: null });

    await handleInvoicePaymentFailed(invoice(), EVENT, deps);

    expect(updates).toEqual([]);
    expect(emails).toEqual([]);
  });

  it("should still email when a newer account update skips the past_due write", async () => {
    const { deps, updates, emails } = harness({
      account: account({ updated_at: "2026-08-04T19:00:00.000Z" }),
    });

    await handleInvoicePaymentFailed(invoice(), EVENT, deps);

    expect(updates).toEqual([]);
    expect(emails).toHaveLength(1);
  });

  it("should keep a dispute freeze and still email", async () => {
    const { deps, updates, emails } = harness({
      account: account({ status: "frozen_topups" }),
    });

    await handleInvoicePaymentFailed(invoice(), EVENT, deps);

    expect(updates).toEqual([]);
    expect(emails).toHaveLength(1);
  });

  it.each(["paid", "void"] as const)(
    "should not email once the invoice is %s",
    async (status) => {
      const { deps, emails } = harness({ current: invoice({ status }) });

      await handleInvoicePaymentFailed(invoice(), EVENT, deps);

      expect(emails).toEqual([]);
    }
  );

  it("should still email when Stripe marks the invoice uncollectible after the final attempt", async () => {
    const { deps, emails } = harness({
      current: invoice({ status: "uncollectible", next_payment_attempt: null }),
    });

    await handleInvoicePaymentFailed(invoice(), EVENT, deps);

    expect(emails[0]?.nextAttemptAt).toBeNull();
  });

  it.each([
    ["email", { customer_email: null }],
    ["hosted_invoice_url", { hosted_invoice_url: null }],
  ] as const)(
    "should ack without email when the invoice has no %s",
    async (missing, overrides) => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const { deps, emails } = harness({ current: invoice(overrides) });

      await handleInvoicePaymentFailed(invoice(), EVENT, deps);

      expect(emails).toEqual([]);
      expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
        event: "payment_failed_email_undeliverable",
        missing,
      });
    }
  );

  it("should throw so Stripe redelivers when the email is not sent", async () => {
    const { deps } = harness({ sendOk: false });

    await expect(
      handleInvoicePaymentFailed(invoice(), EVENT, deps)
    ).rejects.toThrow("payment-failed email for invoice in_1 not sent");
  });
});
