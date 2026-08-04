import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";
import { isBillingEnabled } from "@/lib/billing/stripe";
import { findBillingAccountForScope } from "@/lib/billing/accounts";
import { getBillingBalance } from "@/lib/billing/ledger";

// Billing summary for the current scope (Settings → Billing). Any member
// can read balance/tier; mutating flows (checkout/portal) stay
// billing.manage-gated.

export async function GET(request: Request) {
  if (!isBillingEnabled()) {
    return NextResponse.json({ enabled: false });
  }
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const resolution = await resolveProductResourceScope({ request, userId });
  if (!resolution.ok) {
    return NextResponse.json(
      { error: resolution.error },
      { status: resolution.status }
    );
  }

  const account = await findBillingAccountForScope(resolution.scope);
  const balance = account
    ? await getBillingBalance(account.id)
    : { includedCents: 0, purchasedCents: 0, totalCents: 0 };
  return NextResponse.json({
    enabled: true,
    tier: account?.tier ?? "free",
    status: account?.status ?? "active",
    hasSubscription: Boolean(account?.stripe_subscription_id),
    hasStripeCustomer: Boolean(account?.stripe_customer_id),
    balance: {
      includedCents: balance.includedCents,
      purchasedCents: balance.purchasedCents,
      totalCents: balance.totalCents,
    },
  });
}
