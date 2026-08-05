import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { findPlanPrice } from "@/lib/billing/catalog";
import { postBillingPeriodGrant } from "@/lib/billing/ledger";
import { getStripe, isBillingEnabled } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

const GRANT_CONCURRENCY = 20;

export type AnnualGrantCandidate = {
  id: string;
  stripe_subscription_id: string;
  period_anchor: string;
};

export type AnnualGrantSummary = {
  scanned: number;
  granted: number;
  duplicates: number;
  skipped: number;
  errored: number;
  disabled: boolean;
};

type AnnualGrantDeps = {
  isBillingEnabled: typeof isBillingEnabled;
  loadCandidates: typeof loadAnnualGrantCandidates;
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  postBillingPeriodGrant: typeof postBillingPeriodGrant;
  captureException: typeof Sentry.captureException;
};

const defaultDeps: AnnualGrantDeps = {
  isBillingEnabled,
  loadCandidates: loadAnnualGrantCandidates,
  retrieveSubscription: (id) => getStripe().subscriptions.retrieve(id),
  postBillingPeriodGrant,
  captureException: Sentry.captureException,
};

export async function loadAnnualGrantCandidates(): Promise<
  AnnualGrantCandidate[]
> {
  const rows = await fetchAllRows(
    () =>
      supabaseAdmin
        .from("billing_accounts")
        .select("id, stripe_subscription_id, period_anchor, created_at")
        .not("stripe_subscription_id", "is", null)
        .not("period_anchor", "is", null),
    "created_at",
    "annual billing grant candidates"
  );
  return rows as AnnualGrantCandidate[];
}

function parseAnchor(anchor: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function annualGrantPeriod(
  periodAnchor: string,
  now: Date
): string | null {
  const anchor = parseAnchor(periodAnchor);
  if (!anchor || Number.isNaN(now.getTime())) return null;

  const monthOffset =
    (now.getUTCFullYear() - anchor.year) * 12 +
    (now.getUTCMonth() - anchor.month);
  // The invoice webhook owns the first month and every annual renewal month.
  if (monthOffset <= 0 || monthOffset % 12 === 0) return null;

  const lastDayOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const dueDay = Math.min(anchor.day, lastDayOfMonth);
  if (now.getUTCDate() < dueDay) return null;

  return now.toISOString().slice(0, 7);
}

type AnnualGrantOutcome = "granted" | "duplicates" | "skipped" | "errored";

async function grantCandidate(
  candidate: AnnualGrantCandidate,
  now: Date,
  deps: AnnualGrantDeps
): Promise<AnnualGrantOutcome> {
  try {
    const period = annualGrantPeriod(candidate.period_anchor, now);
    if (!period) return "skipped";

    const subscription = await deps.retrieveSubscription(
      candidate.stripe_subscription_id
    );
    if (subscription.status !== "active") return "skipped";
    const lookupKey = subscription.items.data[0]?.price.lookup_key;
    const plan = lookupKey ? findPlanPrice(lookupKey) : null;
    if (plan?.interval !== "year") return "skipped";

    const grant = await deps.postBillingPeriodGrant({
      accountId: candidate.id,
      deltaCents: plan.includedUsageCents,
      grantSourceRef: `grant:${candidate.id}:${period}:${candidate.stripe_subscription_id}`,
      expirySourceRef: `grantexp:${candidate.id}:${period}:${candidate.stripe_subscription_id}`,
      period,
      metadata: { source: "annual_schedule", plan: plan.lookupKey },
    });
    return grant.posted ? "granted" : "duplicates";
  } catch (error) {
    deps.captureException(error, {
      extra: {
        billing_account_id: candidate.id,
        stripe_subscription_id: candidate.stripe_subscription_id,
        period_anchor: candidate.period_anchor,
      },
    });
    return "errored";
  }
}

export async function runAnnualIncludedUsageGrants(
  now: Date = new Date(),
  overrides: Partial<AnnualGrantDeps> = {}
): Promise<AnnualGrantSummary> {
  const deps = { ...defaultDeps, ...overrides };
  const summary: AnnualGrantSummary = {
    scanned: 0,
    granted: 0,
    duplicates: 0,
    skipped: 0,
    errored: 0,
    disabled: !deps.isBillingEnabled(),
  };
  if (summary.disabled) return summary;

  const candidates = await deps.loadCandidates();
  summary.scanned = candidates.length;

  for (let index = 0; index < candidates.length; index += GRANT_CONCURRENCY) {
    const outcomes = await Promise.all(
      candidates
        .slice(index, index + GRANT_CONCURRENCY)
        .map((candidate) => grantCandidate(candidate, now, deps))
    );
    for (const outcome of outcomes) summary[outcome] += 1;
  }
  return summary;
}
