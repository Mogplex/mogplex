import { NextResponse } from "next/server";
import {
  capacityStripeCatalogDeps,
  syncCapacityStripeCatalog,
} from "@/lib/billing/capacity-stripe-catalog";
import { capacityBillingStripeMode, getStripe } from "@/lib/billing/stripe";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type CapacityStripeCatalogRouteDeps = {
  requireMachineApiAuth: typeof requireMachineApiAuth;
  capacityBillingStripeMode: typeof capacityBillingStripeMode;
  syncCatalog: () => ReturnType<typeof syncCapacityStripeCatalog>;
};

const defaultDeps: CapacityStripeCatalogRouteDeps = {
  requireMachineApiAuth,
  capacityBillingStripeMode,
  syncCatalog: () =>
    syncCapacityStripeCatalog({
      deps: capacityStripeCatalogDeps(getStripe()),
    }),
};

export function createCapacityStripeCatalogPostHandler(
  overrides: Partial<CapacityStripeCatalogRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function POST(request: Request) {
    const authResponse = deps.requireMachineApiAuth(
      request,
      "/api/cron/capacity-stripe-catalog"
    );
    if (authResponse) return authResponse;

    const mode = deps.capacityBillingStripeMode();
    if (mode !== "live") {
      return NextResponse.json({
        ok: true,
        status: "skipped",
        reason: "live_capacity_billing_disabled",
      });
    }

    try {
      const result = await deps.syncCatalog();
      return NextResponse.json({
        ok: true,
        status: "synced",
        mode,
        ...result,
      });
    } catch (error) {
      console.error("[capacity-stripe-catalog] sync failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(
        { ok: false, error: "Capacity Stripe catalog sync failed" },
        { status: 500 }
      );
    }
  };
}

export const POST = createCapacityStripeCatalogPostHandler();
