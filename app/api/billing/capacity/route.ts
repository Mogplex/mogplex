import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getOrCreateBillingAccount } from "@/lib/billing/accounts";
import { loadCapacityBillingSummary } from "@/lib/billing/capacity-summary-db";
import { getBillingBalance } from "@/lib/billing/ledger";
import { areCapacityBillingOperationsEnabled } from "@/lib/billing/stripe";
import { hasCapability } from "@/lib/team-capabilities";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";

type CapacityBillingSummaryDeps = {
  requireUserId: typeof requireUserId;
  resolveProductResourceScope: typeof resolveProductResourceScope;
  getOrCreateBillingAccount: typeof getOrCreateBillingAccount;
  getBillingBalance: typeof getBillingBalance;
  loadCapacityBillingSummary: typeof loadCapacityBillingSummary;
  areCapacityBillingOperationsEnabled: typeof areCapacityBillingOperationsEnabled;
};

const defaultDeps: CapacityBillingSummaryDeps = {
  requireUserId,
  resolveProductResourceScope,
  getOrCreateBillingAccount,
  getBillingBalance,
  loadCapacityBillingSummary,
  areCapacityBillingOperationsEnabled,
};

export function createCapacityBillingSummaryGetHandler(
  overrides: Partial<CapacityBillingSummaryDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function GET(request: Request) {
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

    const canManageBilling =
      resolution.scope.kind === "personal" ||
      hasCapability(resolution.capabilities ?? new Set(), "billing.manage");
    try {
      const account = await deps.getOrCreateBillingAccount(resolution.scope);
      const balance = await deps.getBillingBalance(account.id);
      const summary = await deps.loadCapacityBillingSummary({
        accountId: account.id,
        balance,
        scope: resolution.scope.kind,
        canManageBilling,
        billingOperationsEnabled: deps.areCapacityBillingOperationsEnabled(),
      });
      return NextResponse.json(summary);
    } catch (error) {
      console.error("[capacity-billing] summary failed", {
        scope: resolution.scope.kind,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(
        { error: "Billing summary is unavailable" },
        { status: 500 }
      );
    }
  };
}

export const GET = createCapacityBillingSummaryGetHandler();
