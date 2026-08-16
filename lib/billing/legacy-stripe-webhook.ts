import type Stripe from "stripe";
import type { BillingAccount } from "@/lib/billing/accounts";
import {
  findPlanPrice,
  PLAN_PRICES,
  type PlanPrice,
} from "@/lib/billing/catalog";
import type { BillingPeriodGrant, LedgerEntry } from "@/lib/billing/ledger";

type LegacyStripeWebhookDeps = {
  postLedgerEntry: (entry: LedgerEntry) => Promise<{ posted: boolean }>;
  postBillingPeriodGrant: (
    grant: BillingPeriodGrant
  ) => Promise<{ posted: boolean; expiredCents: number }>;
  updateAccount: (
    id: string,
    updates: {
      tier?: BillingAccount["tier"];
      stripe_subscription_id?: string | null;
      status?: BillingAccount["status"];
      period_anchor?: string | null;
    }
  ) => Promise<void>;
};

function periodOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

async function postUpgradeGrantAdjustment(input: {
  account: BillingAccount;
  invoice: Stripe.Invoice;
  subscription: Stripe.Subscription;
  plan: PlanPrice;
  period: string;
  grantPosted: boolean;
  deps: LegacyStripeWebhookDeps;
}) {
  const { account, invoice, subscription, plan, period, deps } = input;
  const priorIncludedUsageCents = PLAN_PRICES.find(
    (candidate) => candidate.tier === account.tier
  )?.includedUsageCents;
  const isPaidUpgrade =
    !input.grantPosted &&
    account.tier !== "free" &&
    account.tier !== plan.tier &&
    priorIncludedUsageCents !== undefined &&
    plan.includedUsageCents > priorIncludedUsageCents;
  if (!isPaidUpgrade) return;
  await deps.postLedgerEntry({
    accountId: account.id,
    deltaCents: plan.includedUsageCents - priorIncludedUsageCents,
    bucket: "included",
    kind: "grant_adjustment",
    sourceRef: `grantadj:${account.id}:${subscription.id}:${period}:${plan.lookupKey}`,
    period,
    metadata: { invoice: invoice.id, plan: plan.lookupKey },
  });
}

export async function handleLegacyInvoicePaid(input: {
  account: BillingAccount;
  invoice: Stripe.Invoice;
  subscription: Stripe.Subscription;
  deps: LegacyStripeWebhookDeps;
}) {
  const { account, invoice, subscription, deps } = input;
  const item = subscription.items.data[0];
  const lookupKey = item?.price.lookup_key;
  const plan = lookupKey ? findPlanPrice(lookupKey) : null;
  if (!plan || !item) {
    throw new Error(
      `paid invoice ${invoice.id} references an unknown subscription price`
    );
  }

  const periodStart = new Date(item.current_period_start * 1_000);
  const period = periodOf(periodStart);
  const grant = await deps.postBillingPeriodGrant({
    accountId: account.id,
    deltaCents: plan.includedUsageCents,
    grantSourceRef: `grant:${account.id}:${period}:${subscription.id}`,
    expirySourceRef: `grantexp:${account.id}:${period}:${subscription.id}`,
    period,
    metadata: { invoice: invoice.id, plan: plan.lookupKey },
  });
  await postUpgradeGrantAdjustment({
    account,
    invoice,
    subscription,
    plan,
    period,
    grantPosted: grant.posted,
    deps,
  });
  await deps.updateAccount(account.id, {
    tier: plan.tier,
    stripe_subscription_id: subscription.id,
    ...(account.status === "frozen_topups"
      ? {}
      : { status: "active" as const }),
    period_anchor: periodStart.toISOString().slice(0, 10),
  });
}
