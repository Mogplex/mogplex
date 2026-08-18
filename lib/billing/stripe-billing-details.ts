import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import type { CapacityBillingDetails } from "@/lib/billing/capacity-summary-types";

type PaymentMethodSummary = Pick<Stripe.PaymentMethod, "type" | "card">;

type InvoiceSummary = Pick<
  Stripe.Invoice,
  | "id"
  | "number"
  | "description"
  | "status"
  | "amount_due"
  | "amount_paid"
  | "currency"
  | "created"
  | "hosted_invoice_url"
  | "invoice_pdf"
  | "lines"
>;

export type StripeBillingDetailsDeps = {
  findPaymentMethod: (
    customerId: string
  ) => Promise<PaymentMethodSummary | null>;
  listInvoices: (customerId: string) => AsyncIterable<InvoiceSummary>;
};

async function findPaymentMethod(
  customerId: string
): Promise<PaymentMethodSummary | null> {
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (customer.deleted) return null;

  const configured = customer.invoice_settings.default_payment_method;
  if (configured) {
    return typeof configured === "string"
      ? await stripe.paymentMethods.retrieve(configured)
      : configured;
  }

  const methods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 1,
  });
  return methods.data[0] ?? null;
}

function defaultDeps(): StripeBillingDetailsDeps {
  return {
    findPaymentMethod,
    listInvoices: (customerId) =>
      getStripe().invoices.list({ customer: customerId, limit: 100 }),
  };
}

function summarizePaymentMethod(
  method: PaymentMethodSummary | null
): CapacityBillingDetails["paymentMethod"] {
  if (method?.type !== "card" || !method.card) return null;
  return {
    brand: method.card.brand,
    last4: method.card.last4,
    expMonth: method.card.exp_month,
    expYear: method.card.exp_year,
  };
}

function summarizeInvoice(
  invoice: InvoiceSummary
): CapacityBillingDetails["invoices"][number] {
  return {
    id: invoice.id,
    number: invoice.number,
    description:
      invoice.description ||
      invoice.lines.data[0]?.description ||
      "Mogplex purchase",
    status: invoice.status,
    amountCents:
      invoice.amount_paid > 0 ? invoice.amount_paid : invoice.amount_due,
    currency: invoice.currency,
    createdAt: new Date(invoice.created * 1_000).toISOString(),
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
  };
}

export async function loadStripeBillingDetails(
  customerId: string,
  deps: StripeBillingDetailsDeps = defaultDeps()
): Promise<CapacityBillingDetails> {
  const [paymentMethod, invoices] = await Promise.all([
    deps.findPaymentMethod(customerId),
    (async () => {
      const results: InvoiceSummary[] = [];
      for await (const invoice of deps.listInvoices(customerId)) {
        results.push(invoice);
      }
      return results;
    })(),
  ]);

  return {
    paymentMethod: summarizePaymentMethod(paymentMethod),
    invoices: invoices.map(summarizeInvoice),
  };
}
