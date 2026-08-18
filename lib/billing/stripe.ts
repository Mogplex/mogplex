import Stripe from "stripe";

// Billing modules no-op without Stripe env keys (pricing-plan 03 §5):
// self-host installs must never hit billing code paths.
export function isBillingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export type CapacityBillingStripeMode = "test" | "live";

// Live capacity billing requires its own second switch. This keeps test
// operations easy to exercise while making a production rollback a single env
// change that does not disable legacy Stripe billing.
export function capacityBillingStripeMode(): CapacityBillingStripeMode | null {
  if (process.env.CAPACITY_BILLING_OPERATIONS_ENABLED !== "true") return null;
  const key = process.env.STRIPE_SECRET_KEY;
  if (key?.startsWith("sk_test_") === true) return "test";
  if (
    key?.startsWith("sk_live_") === true &&
    process.env.CAPACITY_BILLING_LIVE_WRITES_ENABLED === "true"
  ) {
    return "live";
  }
  return null;
}

export function areCapacityBillingOperationsEnabled(): boolean {
  return capacityBillingStripeMode() !== null;
}

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  // apiVersion is omitted on purpose: stripe-node sends the version it was
  // built against, so the pin moves only when the dependency is upgraded
  // deliberately (pricing-plan 02 §1).
  cached ??= new Stripe(key);
  return cached;
}
