import type Stripe from "stripe";
import type {
  BillingAccount,
  updateBillingAccount,
} from "@/lib/billing/accounts";
import type {
  PaymentFailedEmailParams,
  PaymentFailedSendResult,
} from "@/lib/email/send-payment-failed";

export type InvoicePaymentFailedDeps = {
  findAccountByCustomer: (customerId: string) => Promise<BillingAccount | null>;
  updateAccount: (
    id: string,
    updates: Parameters<typeof updateBillingAccount>[1]
  ) => Promise<void>;
  retrieveInvoice: (id: string) => Promise<Stripe.Invoice>;
  sendPaymentFailedEmail: (
    params: PaymentFailedEmailParams
  ) => Promise<PaymentFailedSendResult>;
};

// Paid or voided since the attempt failed: there is nothing left to ask for.
const SETTLED_INVOICE_STATUSES = new Set(["paid", "void"]);

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

async function markPastDue(
  account: BillingAccount,
  eventCreated: number,
  deps: InvoicePaymentFailedDeps
) {
  const accountUpdatedAt = account.updated_at
    ? Date.parse(account.updated_at) / 1000
    : 0;
  if (accountUpdatedAt > eventCreated) return;
  // Smart Retries run on Stripe's side; tier persists through the period
  // (grace), drop-to-free happens via customer.subscription.deleted.
  if (account.status !== "frozen_topups") {
    await deps.updateAccount(account.id, { status: "past_due" });
  }
}

/**
 * Tells the billing contact a charge failed. Gated on the invoice's current
 * Stripe state rather than the account's updated_at, because unrelated
 * subscription syncs touch the account around every failure. A delivery
 * failure throws so the webhook stays unprocessed and Stripe redelivers;
 * the per-event idempotency key keeps the redelivery from double-sending.
 */
async function notifyBillingContact(
  invoiceId: string,
  eventId: string,
  deps: InvoicePaymentFailedDeps
) {
  const invoice = await deps.retrieveInvoice(invoiceId);
  if (invoice.status && SETTLED_INVOICE_STATUSES.has(invoice.status)) return;
  if (!invoice.customer_email || !invoice.hosted_invoice_url) {
    // Not retryable: a redelivery reads the same invoice. Log loudly instead.
    console.error(
      JSON.stringify({
        event: "payment_failed_email_undeliverable",
        invoice: invoice.id,
        missing: invoice.customer_email ? "hosted_invoice_url" : "email",
      })
    );
    return;
  }
  const result = await deps.sendPaymentFailedEmail({
    email: invoice.customer_email,
    amountCents: invoice.amount_remaining,
    currency: invoice.currency,
    nextAttemptAt: invoice.next_payment_attempt
      ? new Date(invoice.next_payment_attempt * 1000)
      : null,
    payUrl: invoice.hosted_invoice_url,
    idempotencyKey: `invoice-payment-failed/${eventId}`,
  });
  if (!result.ok) {
    throw new Error(
      `payment-failed email for invoice ${invoice.id} not sent: ${result.reason}`
    );
  }
}

/** Handles invoice.payment_failed: marks the account past_due and emails the billing contact. */
export async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  event: { id: string; created: number },
  deps: InvoicePaymentFailedDeps
) {
  const customerId = customerIdOf(invoice.customer);
  if (!customerId) return;
  const account = await deps.findAccountByCustomer(customerId);
  if (!account) return;
  await markPastDue(account, event.created, deps);
  if (!invoice.id) return;
  await notifyBillingContact(invoice.id, event.id, deps);
}
