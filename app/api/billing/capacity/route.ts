import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getOrCreateBillingAccount } from "@/lib/billing/accounts";
import { INDIVIDUAL_CAPACITY_PLANS } from "@/lib/billing/capacity-catalog";
import { loadCapacityBillingSummary } from "@/lib/billing/capacity-summary-db";
import { getBillingBalance } from "@/lib/billing/ledger";
import { isCapacityBillingPilotAccount } from "@/lib/billing/capacity-purchase-policy";
import {
  areCapacityBillingOperationsEnabled,
  isBillingEnabled,
} from "@/lib/billing/stripe";
import { loadStripeBillingDetails } from "@/lib/billing/stripe-billing-details";
import { hasCapability } from "@/lib/team-capabilities";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";

type CapacityBillingSummaryDeps = {
  requireUserId: typeof requireUserId;
  resolveProductResourceScope: typeof resolveProductResourceScope;
  getOrCreateBillingAccount: typeof getOrCreateBillingAccount;
  getBillingBalance: typeof getBillingBalance;
  loadCapacityBillingSummary: typeof loadCapacityBillingSummary;
  areCapacityBillingOperationsEnabled: typeof areCapacityBillingOperationsEnabled;
  isCapacityBillingPilotAccount: typeof isCapacityBillingPilotAccount;
  isBillingEnabled: typeof isBillingEnabled;
  loadStripeBillingDetails: typeof loadStripeBillingDetails;
};

const defaultDeps: CapacityBillingSummaryDeps = {
  requireUserId,
  resolveProductResourceScope,
  getOrCreateBillingAccount,
  getBillingBalance,
  loadCapacityBillingSummary,
  areCapacityBillingOperationsEnabled,
  isCapacityBillingPilotAccount,
  isBillingEnabled,
  loadStripeBillingDetails,
};

const INDIVIDUAL_CAPACITY_PLAN_CODES = new Set(
  Object.keys(INDIVIDUAL_CAPACITY_PLANS)
);

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
      const billingOperationsEnabled =
        deps.areCapacityBillingOperationsEnabled();
      const hasIndividualCapacityPlan = INDIVIDUAL_CAPACITY_PLAN_CODES.has(
        account.plan_code ?? ""
      );
      const summary = await deps.loadCapacityBillingSummary({
        accountId: account.id,
        balance,
        scope: resolution.scope.kind,
        canManageBilling,
        billingOperationsEnabled,
        concurrencyPurchasesEnabled:
          billingOperationsEnabled &&
          hasIndividualCapacityPlan &&
          deps.isCapacityBillingPilotAccount(account.id),
      });
      let billingDetails = null;
      if (
        canManageBilling &&
        account.stripe_customer_id &&
        deps.isBillingEnabled()
      ) {
        try {
          billingDetails = await deps.loadStripeBillingDetails(
            account.stripe_customer_id
          );
        } catch (error) {
          console.warn("[capacity-billing] Stripe details unavailable", {
            accountId: account.id,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
      return NextResponse.json({ ...summary, billingDetails });
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
