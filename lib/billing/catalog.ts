// Stripe product/price catalog. lookup_key is the cross-environment
// identity: the deployment's seed tooling creates/updates by lookup_key and
// runtime code resolves prices the same way, so no environment-specific
// Stripe IDs are ever stored.

export type PlanTier = "pro" | "team" | "business";
export type PlanInterval = "month" | "year";

export type PlanPrice = {
  lookupKey: string;
  productName: string;
  tier: PlanTier;
  interval: PlanInterval;
  amountCents: number;
  // Granted monthly even on annual plans — annual grants come from a
  // scheduled task, not invoice.paid (pricing-plan 02 §5).
  includedUsageCents: number;
};

export const PLAN_PRICES: readonly PlanPrice[] = [
  {
    lookupKey: "pro_monthly",
    productName: "Mogplex Pro",
    tier: "pro",
    interval: "month",
    amountCents: 2000,
    includedUsageCents: 2000,
  },
  {
    lookupKey: "pro_annual",
    productName: "Mogplex Pro",
    tier: "pro",
    interval: "year",
    amountCents: 19200,
    includedUsageCents: 2000,
  },
  {
    lookupKey: "team_monthly",
    productName: "Mogplex Team",
    tier: "team",
    interval: "month",
    amountCents: 10000,
    includedUsageCents: 10000,
  },
  {
    lookupKey: "team_annual",
    productName: "Mogplex Team",
    tier: "team",
    interval: "year",
    amountCents: 96000,
    includedUsageCents: 10000,
  },
  // Sold as "Mog Mode" — `business` stays the internal tier key so the DB
  // constraint and webhook logic survive display-name changes.
  {
    lookupKey: "business_monthly",
    productName: "Mogplex Mog Mode",
    tier: "business",
    interval: "month",
    amountCents: 20000,
    includedUsageCents: 20000,
  },
  {
    lookupKey: "business_annual",
    productName: "Mogplex Mog Mode",
    tier: "business",
    interval: "year",
    amountCents: 192000,
    includedUsageCents: 20000,
  },
];

export const TOPUP_PRODUCT_NAME = "Mogplex Usage Top-up";

export type TopupPreset = { lookupKey: string; amountCents: number };

export const TOPUP_PRESETS: readonly TopupPreset[] = [
  { lookupKey: "topup_10", amountCents: 1000 },
  { lookupKey: "topup_25", amountCents: 2500 },
  { lookupKey: "topup_100", amountCents: 10000 },
  { lookupKey: "topup_250", amountCents: 25000 },
  { lookupKey: "topup_500", amountCents: 50000 },
  { lookupKey: "topup_1000", amountCents: 100000 },
];

// Vercel bills active sandbox sessions at $0.005/minute. Keep the published
// rate with the rest of the billing catalog so charging and marketing cannot
// drift.
export const SANDBOX_RATE_MICRO_USD_PER_MINUTE = 5_000;

// Fraud guardrails, not usage limits (pricing-plan 02 §3b): the cap is
// raised on request instantly. $10–$1,000 range signed off by Charles
// 2026-08-07 (top-ups are manual-only at launch — auto top-up is outside
// the Managed Payments merchant-of-record consent, pricing-plan 02 §3c).
export const TOPUP_MIN_CENTS = 1000;
export const TOPUP_MAX_CENTS = 100000;

export function formatUsd(amountCents: number): string {
  const sign = amountCents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(amountCents) / 100).toFixed(2)}`;
}

export function findPlanPrice(lookupKey: string): PlanPrice | null {
  return PLAN_PRICES.find((plan) => plan.lookupKey === lookupKey) ?? null;
}

export function findTopupPreset(lookupKey: string): TopupPreset | null {
  return TOPUP_PRESETS.find((preset) => preset.lookupKey === lookupKey) ?? null;
}
