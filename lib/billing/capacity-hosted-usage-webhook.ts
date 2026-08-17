import type Stripe from "stripe";
import type { BillingAccount } from "@/lib/billing/accounts";
import {
  CAPACITY_CATALOG_VERSION,
  CAPACITY_HOSTED_USAGE_MAX_CENTS,
  CAPACITY_HOSTED_USAGE_MIN_CENTS,
} from "@/lib/billing/capacity-catalog";
import type { LedgerEntry } from "@/lib/billing/ledger";
import type { CapacityBillingStripeMode } from "@/lib/billing/stripe";

export type CapacityHostedUsageWebhookDeps = {
  capacityBillingOperationsEnabled: () => boolean;
  capacityBillingStripeMode: () => CapacityBillingStripeMode | null;
  findAccountById: (id: string) => Promise<BillingAccount | null>;
  postLedgerEntry: (entry: LedgerEntry) => Promise<{ posted: boolean }>;
};

const CHECKOUT_ATTEMPT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function stampedUsagePurchaseCents(
  paymentIntent: Stripe.PaymentIntent
): number {
  const stampedCredit = Number(paymentIntent.metadata.credit_cents);
  if (!Number.isInteger(stampedCredit) || stampedCredit <= 0) {
    throw new Error(
      `usage purchase PaymentIntent ${paymentIntent.id} is missing a valid credit_cents stamp`
    );
  }
  return stampedCredit;
}

export function assertCapacityHostedUsagePayment(
  paymentIntent: Stripe.PaymentIntent,
  deps: Pick<
    CapacityHostedUsageWebhookDeps,
    "capacityBillingOperationsEnabled" | "capacityBillingStripeMode"
  >
) {
  if (!deps.capacityBillingOperationsEnabled()) {
    throw new Error("Capacity billing operations are disabled");
  }
  const stripeMode = deps.capacityBillingStripeMode();
  const creditCents = stampedUsagePurchaseCents(paymentIntent);
  const contractViolations = [
    stripeMode === null,
    paymentIntent.livemode !== (stripeMode === "live"),
    paymentIntent.status !== "succeeded",
    paymentIntent.metadata.catalog_version !== CAPACITY_CATALOG_VERSION,
    !CHECKOUT_ATTEMPT_ID.test(
      String(paymentIntent.metadata.checkout_attempt_id)
    ),
    paymentIntent.currency !== "usd",
    !Number.isSafeInteger(paymentIntent.amount_received),
    paymentIntent.amount_received < creditCents,
    creditCents < CAPACITY_HOSTED_USAGE_MIN_CENTS,
    creditCents > CAPACITY_HOSTED_USAGE_MAX_CENTS,
  ];
  if (contractViolations.some(Boolean)) {
    throw new Error(
      `hosted-usage PaymentIntent ${paymentIntent.id} does not match the capacity purchase contract`
    );
  }
}

export async function handleCapacityHostedUsagePaymentIfApplicable(input: {
  paymentIntent: Stripe.PaymentIntent;
  deps: CapacityHostedUsageWebhookDeps;
}): Promise<boolean> {
  if (input.paymentIntent.metadata?.kind !== "hosted_usage") return false;
  assertCapacityHostedUsagePayment(input.paymentIntent, input.deps);
  const accountId = input.paymentIntent.metadata.billing_account_id;
  if (!accountId) {
    throw new Error("hosted-usage payment is missing its billing account");
  }
  const account = await input.deps.findAccountById(accountId);
  if (!account) {
    throw new Error("hosted-usage payment references an unknown account");
  }
  const creditCents = stampedUsagePurchaseCents(input.paymentIntent);
  await input.deps.postLedgerEntry({
    accountId: account.id,
    deltaCents: creditCents,
    bucket: "purchased",
    kind: "topup",
    sourceRef: `hosted-usage:${input.paymentIntent.id}`,
    metadata: {
      purchase_kind: "capacity",
      catalog_version: CAPACITY_CATALOG_VERSION,
      payment_intent: input.paymentIntent.id,
      amount_received: input.paymentIntent.amount_received,
    },
  });
  return true;
}
