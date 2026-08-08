import { findPlanPrice, formatUsd, type PlanTier } from "@/lib/billing/catalog";

// Plan intent carried from a /pricing tier card through signup to /checkout.
// The value is the internal tier key; display names stay a UI concern
// ("business" renders as "Mog Mode").

const PLAN_INTENT_TIERS = new Set<PlanTier>(["pro", "team", "business"]);

export function parsePlanIntent(
  raw: string | null | undefined
): PlanTier | null {
  if (!raw) return null;
  return PLAN_INTENT_TIERS.has(raw as PlanTier) ? (raw as PlanTier) : null;
}

export function planIntentDisplayName(tier: PlanTier): string {
  if (tier === "business") return "Mog Mode";
  return tier === "pro" ? "Pro" : "Team";
}

export function checkoutPath(tier: PlanTier): string {
  return `/checkout?plan=${tier}`;
}

export function signupPath(tier: PlanTier | null): string {
  return tier ? `/signup?plan=${tier}` : "/signup";
}

export type PlanIntentSummary = {
  tier: PlanTier;
  name: string;
  monthlyLookupKey: string;
  annualLookupKey: string;
  monthlyPrice: string;
  annualPrice: string;
  includedUsage: string;
};

export function planIntentSummary(tier: PlanTier): PlanIntentSummary {
  const monthly = findPlanPrice(`${tier}_monthly`);
  const annual = findPlanPrice(`${tier}_annual`);
  if (!monthly || !annual) {
    throw new Error(`Billing catalog is missing prices for tier "${tier}"`);
  }
  return {
    tier,
    name: planIntentDisplayName(tier),
    monthlyLookupKey: monthly.lookupKey,
    annualLookupKey: annual.lookupKey,
    monthlyPrice: formatUsd(monthly.amountCents),
    annualPrice: formatUsd(annual.amountCents),
    includedUsage: formatUsd(monthly.includedUsageCents),
  };
}
