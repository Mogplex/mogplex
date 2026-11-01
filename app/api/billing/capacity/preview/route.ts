import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getOrCreateBillingAccount } from "@/lib/billing/accounts";
import {
  validateCapacityChangePreviewRequest,
  type CapacityChangePreviewRequest,
} from "@/lib/billing/capacity-change-contract";
import {
  CapacityChangeError,
  previewCapacityChange,
} from "@/lib/billing/capacity-stripe-changes";
import { areCapacityBillingOperationsEnabled } from "@/lib/billing/stripe";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";
import {
  reportBillingError,
  type BillingErrorContext,
} from "@/lib/billing/report-billing-error";

type PreviewRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveProductResourceScope: typeof resolveProductResourceScope;
  getOrCreateBillingAccount: typeof getOrCreateBillingAccount;
  capacityBillingOperationsEnabled: typeof areCapacityBillingOperationsEnabled;
  previewCapacityChange: typeof previewCapacityChange;
  signingSecret: () => string;
};

const defaultDeps: PreviewRouteDeps = {
  requireUserId,
  resolveProductResourceScope,
  getOrCreateBillingAccount,
  capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
  previewCapacityChange,
  signingSecret: () => process.env.STRIPE_SECRET_KEY ?? "",
};

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function routeError(error: unknown, context: BillingErrorContext) {
  if (error instanceof CapacityChangeError) {
    // Typed refusals are expected; a typed 5xx is a provider anomaly.
    if (error.status >= 500)
      await reportBillingError("capacity_preview", error, context);
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  console.error("[capacity-billing] preview failed", {
    ...context,
    error: error instanceof Error ? error.message : "Unknown error",
  });
  await reportBillingError("capacity_preview", error, context);
  return NextResponse.json(
    { error: "Capacity pricing is unavailable" },
    { status: 500 }
  );
}

export function createCapacityPreviewPostHandler(
  overrides: Partial<PreviewRouteDeps> = {}
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
    const validation = validateCapacityChangePreviewRequest(
      await requestBody(request)
    );
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    let accountId: string | undefined;
    try {
      const account = await deps.getOrCreateBillingAccount(resolution.scope);
      accountId = account.id;
      const preview = await deps.previewCapacityChange({
        account,
        request: validation.value as CapacityChangePreviewRequest,
        signingSecret: deps.signingSecret(),
      });
      return NextResponse.json(preview);
    } catch (error) {
      return await routeError(error, {
        scope: resolution.scope.kind,
        accountId,
      });
    }
  };
}

export const POST = createCapacityPreviewPostHandler();
