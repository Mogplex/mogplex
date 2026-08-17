import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getOrCreateBillingAccount } from "@/lib/billing/accounts";
import {
  CapacityPlanCheckoutError,
  createIndividualPlanCheckout,
  validateIndividualPlanCheckoutRequest,
} from "@/lib/billing/capacity-plan-checkout";
import { areCapacityBillingOperationsEnabled } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";

type IndividualPlanCheckoutRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveProductResourceScope: typeof resolveProductResourceScope;
  getOrCreateBillingAccount: typeof getOrCreateBillingAccount;
  capacityBillingOperationsEnabled: typeof areCapacityBillingOperationsEnabled;
  createIndividualPlanCheckout: typeof createIndividualPlanCheckout;
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

const defaultDeps: IndividualPlanCheckoutRouteDeps = {
  requireUserId,
  resolveProductResourceScope,
  getOrCreateBillingAccount,
  capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
  createIndividualPlanCheckout,
  getActorEmail,
};

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function routeError(error: unknown) {
  if (error instanceof CapacityPlanCheckoutError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  console.error("[capacity-billing] Individual plan checkout failed", {
    error: error instanceof Error ? error.message : "Unknown error",
  });
  return NextResponse.json(
    { error: "Individual plan checkout is unavailable" },
    { status: 500 }
  );
}

export function createIndividualPlanCheckoutPostHandler(
  overrides: Partial<IndividualPlanCheckoutRouteDeps> = {}
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
    if (resolution.scope.kind !== "personal") {
      return NextResponse.json(
        {
          error:
            "Individual plan checkout is not available for company workspaces. Contact sales for a company contract.",
          code: "self_service_unavailable",
        },
        { status: 409 }
      );
    }
    if (!deps.capacityBillingOperationsEnabled()) {
      return NextResponse.json(
        { error: "Capacity billing operations are disabled" },
        { status: 503 }
      );
    }
    const validation = validateIndividualPlanCheckoutRequest(
      await requestBody(request)
    );
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    try {
      const [account, actorEmail] = await Promise.all([
        deps.getOrCreateBillingAccount(resolution.scope),
        deps.getActorEmail(userId),
      ]);
      const result = await deps.createIndividualPlanCheckout({
        account,
        actorEmail,
        request: validation.value,
      });
      return NextResponse.json(result);
    } catch (error) {
      return routeError(error);
    }
  };
}

export const POST = createIndividualPlanCheckoutPostHandler();
