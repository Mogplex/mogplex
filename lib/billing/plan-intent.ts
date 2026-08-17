import {
  INDIVIDUAL_CAPACITY_PLANS,
  type IndividualCapacityPlanCode,
} from "@/lib/billing/capacity-catalog";

const PLAN_INTENT_TIERS = new Set<IndividualCapacityPlanCode>([
  "pro",
  "plus",
  "max",
]);

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function parsePlanIntent(
  raw: string | null | undefined
): IndividualCapacityPlanCode | null {
  if (!raw) return null;
  return PLAN_INTENT_TIERS.has(raw as IndividualCapacityPlanCode)
    ? (raw as IndividualCapacityPlanCode)
    : null;
}

export function planIntentDisplayName(
  tier: IndividualCapacityPlanCode
): string {
  return INDIVIDUAL_CAPACITY_PLANS[tier].name;
}

export function checkoutPath(tier: IndividualCapacityPlanCode): string {
  return `/checkout?plan=${tier}`;
}

export function signupPath(tier: IndividualCapacityPlanCode | null): string {
  return tier ? `/signup?plan=${tier}` : "/signup";
}

export type PlanIntentSummary = {
  tier: IndividualCapacityPlanCode;
  name: string;
  monthlyPrice: string;
  annualPrice: string;
  concurrency: number;
  retainedDataGb: number;
  hostedUsage: string;
};

export function planIntentSummary(
  tier: IndividualCapacityPlanCode
): PlanIntentSummary {
  const plan = INDIVIDUAL_CAPACITY_PLANS[tier];
  return {
    tier,
    name: plan.name,
    monthlyPrice: formatUsd(plan.prices.month.amountCents),
    annualPrice: formatUsd(plan.prices.year.amountCents),
    concurrency: plan.concurrency,
    retainedDataGb: plan.retainedDataBytes / 1_000_000_000,
    hostedUsage: formatUsd(plan.hostedUsageCents),
  };
}
