import Stripe from "stripe";

// Billing modules no-op without Stripe env keys (pricing-plan 03 §5):
// self-host installs must never hit billing code paths.
export function isBillingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
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
