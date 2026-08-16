import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getOrCreateBillingAccount } from "@/lib/billing/accounts";
import { validateCapacityChangeConfirmationRequest } from "@/lib/billing/capacity-change-contract";
import { CapacityChangeError } from "@/lib/billing/capacity-stripe-changes";
import { confirmCapacityIncrease } from "@/lib/billing/capacity-stripe-increase";
import { areCapacityBillingOperationsEnabled } from "@/lib/billing/stripe";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";

type CheckoutRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveProductResourceScope: typeof resolveProductResourceScope;
  getOrCreateBillingAccount: typeof getOrCreateBillingAccount;
  capacityBillingOperationsEnabled: typeof areCapacityBillingOperationsEnabled;
  confirmCapacityIncrease: typeof confirmCapacityIncrease;
  signingSecret: () => string;
};

const defaultDeps: CheckoutRouteDeps = {
  requireUserId,
  resolveProductResourceScope,
  getOrCreateBillingAccount,
  capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
  confirmCapacityIncrease,
  signingSecret: () => process.env.STRIPE_SECRET_KEY ?? "",
};

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function routeError(error: unknown) {
  if (error instanceof CapacityChangeError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  console.error("[capacity-billing] checkout failed", {
    error: error instanceof Error ? error.message : "Unknown error",
  });
  return NextResponse.json(
    { error: "The capacity change could not be submitted" },
    { status: 500 }
  );
}

export function createCapacityCheckoutPostHandler(
  overrides: Partial<CheckoutRouteDeps> = {}
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
    const validation = validateCapacityChangeConfirmationRequest(
      await requestBody(request)
    );
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    try {
      const account = await deps.getOrCreateBillingAccount(resolution.scope);
      const result = await deps.confirmCapacityIncrease({
        account,
        previewToken: validation.value.previewToken,
        attemptId: validation.value.attemptId,
        signingSecret: deps.signingSecret(),
      });
      return NextResponse.json(result);
    } catch (error) {
      return routeError(error);
    }
  };
}

export const POST = createCapacityCheckoutPostHandler();
