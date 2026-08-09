import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";
import { isBillingEnabled } from "@/lib/billing/stripe";
import { findBillingAccountForScope } from "@/lib/billing/accounts";
import { getBillingBalance } from "@/lib/billing/ledger";
import { hasCapability } from "@/lib/team-capabilities";

// Billing summary for the current scope (Settings → Billing). Any member
// can read balance/tier; mutating flows (checkout/portal) stay
// billing.manage-gated.

type BillingSummaryDeps = {
  isBillingEnabled: typeof isBillingEnabled;
  requireUserId: typeof requireUserId;
  resolveProductResourceScope: typeof resolveProductResourceScope;
  findBillingAccountForScope: typeof findBillingAccountForScope;
  getBillingBalance: typeof getBillingBalance;
};

const defaultDeps: BillingSummaryDeps = {
  isBillingEnabled,
  requireUserId,
  resolveProductResourceScope,
  findBillingAccountForScope,
  getBillingBalance,
};

export function createBillingSummaryGetHandler(
  overrides: Partial<BillingSummaryDeps> = {}
) {
  const deps: BillingSummaryDeps = { ...defaultDeps, ...overrides };

  return async function GET(request: Request) {
    const billingOperationsEnabled = deps.isBillingEnabled();
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const resolution = await deps.resolveProductResourceScope({
      request,
      userId,
    });
    if (!resolution.ok) {
      return NextResponse.json(
        { error: resolution.error },
        { status: resolution.status }
      );
    }

    const account = await deps.findBillingAccountForScope(resolution.scope);
    const balance = account
      ? await deps.getBillingBalance(account.id)
      : { includedCents: 0, purchasedCents: 0, totalCents: 0 };
    return NextResponse.json({
      enabled: true,
      billingOperationsEnabled,
      canManageBilling:
        resolution.scope.kind === "personal" ||
        hasCapability(resolution.capabilities ?? new Set(), "billing.manage"),
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
  };
}

export const GET = createBillingSummaryGetHandler();
