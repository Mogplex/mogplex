import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getOrCreateBillingAccount } from "@/lib/billing/accounts";
import {
  HostedUsagePurchaseError,
  createHostedUsageCheckout,
  validateHostedUsageCheckoutRequest,
} from "@/lib/billing/capacity-hosted-usage";
import { areCapacityBillingOperationsEnabled } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";
import {
  reportBillingError,
  type BillingErrorContext,
} from "@/lib/billing/report-billing-error";

type HostedUsageRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveProductResourceScope: typeof resolveProductResourceScope;
  getOrCreateBillingAccount: typeof getOrCreateBillingAccount;
  capacityBillingOperationsEnabled: typeof areCapacityBillingOperationsEnabled;
  createHostedUsageCheckout: typeof createHostedUsageCheckout;
  getActorEmail: (userId: string) => Promise<string | null>;
};

async function getActorEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle<{ email: string | null }>();
  if (error) return null;
  return data?.email ?? null;
}

const defaultDeps: HostedUsageRouteDeps = {
  requireUserId,
  resolveProductResourceScope,
  getOrCreateBillingAccount,
  capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
  createHostedUsageCheckout,
  getActorEmail,
};

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function routeError(error: unknown, context: BillingErrorContext) {
  if (error instanceof HostedUsagePurchaseError) {
    // Typed refusals are expected; a typed 5xx is a provider anomaly.
    if (error.status >= 500)
      await reportBillingError("hosted_usage_checkout", error, context);
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  console.error("[capacity-billing] hosted-usage checkout failed", {
    ...context,
    error: error instanceof Error ? error.message : "Unknown error",
  });
  await reportBillingError("hosted_usage_checkout", error, context);
  return NextResponse.json(
    { error: "Hosted-usage checkout is unavailable" },
    { status: 500 }
  );
}

export function createHostedUsageCheckoutPostHandler(
  overrides: Partial<HostedUsageRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const resolution = await deps.resolveProductResourceScope({
      request,
      userId,
      requiredCapability: "billing.manage",
    });
    if (!resolution.ok) {
      return NextResponse.json(
        { error: resolution.error },
        { status: resolution.status }
      );
    }
    if (!deps.capacityBillingOperationsEnabled()) {
      return NextResponse.json(
        { error: "Capacity billing operations are disabled" },
        { status: 503 }
      );
    }
    const validation = validateHostedUsageCheckoutRequest(
      await requestBody(request)
    );
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    let accountId: string | undefined;
    try {
      const [account, actorEmail] = await Promise.all([
        deps.getOrCreateBillingAccount(resolution.scope),
        deps.getActorEmail(userId),
      ]);
      accountId = account.id;
      const result = await deps.createHostedUsageCheckout({
        account,
        actorEmail,
        request: validation.value,
      });
      return NextResponse.json(result);
    } catch (error) {
      return await routeError(error, {
        scope: resolution.scope.kind,
        accountId,
      });
    }
  };
}

export const POST = createHostedUsageCheckoutPostHandler();
