import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  loadStripeBillingDetails,
  type StripeBillingDetailsDeps,
} from "./stripe-billing-details";

function invoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: "in_1",
    number: "MPX-001",
    description: null,
    status: "paid",
    amount_due: 2_500,
    amount_paid: 2_500,
    currency: "usd",
    created: 1_776_422_400,
    hosted_invoice_url: "https://invoice.stripe.test/in_1",
    invoice_pdf: "https://invoice.stripe.test/in_1.pdf",
    lines: {
      data: [{ description: "$25 inference credit" }],
    },
    ...overrides,
  } as Stripe.Invoice;
}

describe("loadStripeBillingDetails", () => {
  it("returns only protected card metadata and the latest customer invoices", async () => {
    const findPaymentMethod = vi.fn(async () => ({
      type: "card" as const,
      card: {
        brand: "visa",
        last4: "4242",
        exp_month: 12,
        exp_year: 2028,
      } as Stripe.PaymentMethod.Card,
    }));
    const listInvoices = vi.fn(async () => ({
      data: [
        invoice(),
        invoice({
          id: "in_2",
          number: "MPX-002",
          description: "Mogplex Plus",
          amount_due: 10_000,
          amount_paid: 0,
        }),
      ],
      hasMore: true,
    }));

    const details = await loadStripeBillingDetails("cus_1", {
      findPaymentMethod,
      listInvoices,
    });

    expect(findPaymentMethod).toHaveBeenCalledWith("cus_1");
    expect(listInvoices).toHaveBeenCalledWith("cus_1");
    expect(details.paymentMethod).toEqual({
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2028,
    });
    expect(details.hasMoreInvoices).toBe(true);
    expect(details.invoices).toEqual([
      {
        id: "in_1",
        number: "MPX-001",
        description: "$25 inference credit",
        status: "paid",
        amountCents: 2_500,
        currency: "usd",
        createdAt: "2026-04-17T10:40:00.000Z",
        hostedInvoiceUrl: "https://invoice.stripe.test/in_1",
        invoicePdfUrl: "https://invoice.stripe.test/in_1.pdf",
      },
      expect.objectContaining({
        id: "in_2",
        description: "Mogplex Plus",
        amountCents: 10_000,
      }),
    ]);
  });

  it("requests one bounded invoice page", async () => {
    const listInvoices = vi.fn(async () => ({ data: [], hasMore: false }));

    await loadStripeBillingDetails("cus_1", {
      findPaymentMethod: async () => null,
      listInvoices,
    });

    expect(listInvoices).toHaveBeenCalledOnce();
    expect(listInvoices).toHaveBeenCalledWith("cus_1");
  });

  it("does not expose non-card payment method fields", async () => {
    const deps: StripeBillingDetailsDeps = {
      findPaymentMethod: async () => ({
        type: "us_bank_account",
        card: undefined,
      }),
      listInvoices: async () => ({ data: [], hasMore: false }),
    };

    await expect(loadStripeBillingDetails("cus_1", deps)).resolves.toEqual({
      paymentMethod: null,
      invoices: [],
      hasMoreInvoices: false,
    });
  });
});
