import type Stripe from "stripe";
import type { BillingAccount } from "@/lib/billing/accounts";
import {
  CAPACITY_CATALOG_VERSION,
  INDIVIDUAL_CAPACITY_PLANS,
  type CapacityPlanInterval,
  type IndividualCapacityPlan,
  type IndividualCapacityPlanCode,
} from "@/lib/billing/capacity-catalog";
import { sanitizeReturnPath } from "@/lib/billing/checkout";
import {
  areCapacityBillingOperationsEnabled,
  getStripe,
} from "@/lib/billing/stripe";
import {
  ensureStripeCustomer,
  resolveCatalogPriceId,
} from "@/lib/billing/stripe-checkout";

export class CapacityPlanCheckoutError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "CapacityPlanCheckoutError";
  }
}

export type IndividualPlanCheckoutRequest = {
  planCode: IndividualCapacityPlanCode;
  interval: CapacityPlanInterval;
  returnPath: string;
};

export type IndividualPlanCheckoutValidation =
  | { ok: true; value: IndividualPlanCheckoutRequest }
  | { ok: false; error: string };

export type IndividualPlanCheckoutResult = {
  status: "checkout_created";
  url: string;
  plan: {
    code: IndividualCapacityPlanCode;
    name: string;
    interval: CapacityPlanInterval;
    amountCents: number;
    currency: "usd";
    maxNamedUsers: 1;
  };
  entitlementStatus: "pending_webhook";
};

export type IndividualPlanCheckoutDeps = {
  capacityBillingOperationsEnabled: () => boolean;
  ensureCustomer: (
    account: BillingAccount,
    actorEmail: string | null
  ) => Promise<string>;
  resolvePriceId: (lookupKey: string) => Promise<string>;
  createCheckoutSession: (
    params: Stripe.Checkout.SessionCreateParams,
    options: Stripe.RequestOptions
  ) => Promise<Pick<Stripe.Checkout.Session, "id" | "url">>;
  appUrl: (path: string) => string;
};

const REQUEST_KEYS = new Set(["planCode", "interval", "returnPath"]);

function individualPlan(value: unknown): IndividualCapacityPlan | undefined {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(INDIVIDUAL_CAPACITY_PLANS, value)
  ) {
    return undefined;
  }
  return INDIVIDUAL_CAPACITY_PLANS[value as IndividualCapacityPlanCode];
}

function planInterval(value: unknown): CapacityPlanInterval | undefined {
  return value === "month" || value === "year" ? value : undefined;
}

export function validateIndividualPlanCheckoutRequest(
  body: unknown
): IndividualPlanCheckoutValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  if (Object.keys(body).some((key) => !REQUEST_KEYS.has(key))) {
    return { ok: false, error: "Invalid plan checkout field" };
  }
  const { planCode, interval, returnPath } = body as Record<string, unknown>;
  const plan = individualPlan(planCode);
  if (!plan) {
    return { ok: false, error: "Choose Pro, Plus, or Max" };
  }
  const resolvedInterval = planInterval(interval);
  if (!resolvedInterval) {
    return { ok: false, error: "Choose monthly or annual billing" };
  }
  return {
    ok: true,
    value: {
      planCode: plan.code,
      interval: resolvedInterval,
      returnPath: sanitizeReturnPath(returnPath),
    },
  };
}

export function individualPlanCheckoutIdempotencyKey(
  account: BillingAccount
): string {
  const generation = account.subscription_checkout_generation ?? 0;
  if (!account.id || !Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError("Invalid Individual plan checkout scope");
  }
  // All plan choices in one generation share a key. Concurrent retries can
  // therefore never create two subscriptions for the same billing account.
  return `capacity-plan-subscribe:${account.id}:${generation}`;
}

function defaultCheckoutDeps(): IndividualPlanCheckoutDeps {
  if (!areCapacityBillingOperationsEnabled()) {
    throw new CapacityPlanCheckoutError(
      "Capacity billing operations are disabled",
      503,
      "operations_disabled"
    );
  }
  const stripe = getStripe();
  return {
    capacityBillingOperationsEnabled: areCapacityBillingOperationsEnabled,
    ensureCustomer: (account, actorEmail) =>
      ensureStripeCustomer(account, actorEmail),
    resolvePriceId: (lookupKey) => resolveCatalogPriceId(lookupKey),
    createCheckoutSession: (params, options) =>
      stripe.checkout.sessions.create(params, options),
    appUrl: (path) => {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://mogplex.com";
      return `${base.replace(/\/$/, "")}${path}`;
    },
  };
}

function assertAccountCanSubscribe(account: BillingAccount) {
  if (
    account.owner_type !== "user" ||
    !account.owner_user_id ||
    account.product_team_id !== null
  ) {
    throw new CapacityPlanCheckoutError(
      "Individual plan checkout is not available for company workspaces. Contact sales for a company contract.",
      409,
      "self_service_unavailable"
    );
  }
  if (account.status === "frozen_topups") {
    throw new CapacityPlanCheckoutError(
      "This account cannot start a purchase now. Contact support for help.",
      403,
      "purchases_frozen"
    );
  }
  if (account.status !== "active") {
    throw new CapacityPlanCheckoutError(
      "Plan checkout is unavailable until the billing account is active",
      409,
      "account_inactive"
    );
  }
  if (
    account.tier !== "free" ||
    account.stripe_subscription_id ||
    account.plan_code
  ) {
    throw new CapacityPlanCheckoutError(
      "This account already has a subscription. Manage the current plan from billing settings.",
      409,
      "subscription_exists"
    );
  }
}

function billingResultPath(returnPath: string, result: string): string {
  const separator = returnPath.includes("?") ? "&" : "?";
  return `${returnPath}${separator}billing=${result}`;
}

function resolveRequest(request: IndividualPlanCheckoutRequest): {
  plan: IndividualCapacityPlan;
  interval: CapacityPlanInterval;
  returnPath: string;
} {
  const plan = individualPlan(request.planCode);
  if (!plan) {
    throw new CapacityPlanCheckoutError(
      "Choose Pro, Plus, or Max",
      400,
      "invalid_plan"
    );
  }
  const interval = planInterval(request.interval);
  if (!interval) {
    throw new CapacityPlanCheckoutError(
      "Choose monthly or annual billing",
      400,
      "invalid_interval"
    );
  }
  return {
    plan,
    interval,
    returnPath: sanitizeReturnPath(request.returnPath),
  };
}

export async function createIndividualPlanCheckout(input: {
  account: BillingAccount;
  actorEmail: string | null;
  request: IndividualPlanCheckoutRequest;
  deps?: IndividualPlanCheckoutDeps;
}): Promise<IndividualPlanCheckoutResult> {
  const deps = input.deps ?? defaultCheckoutDeps();
  if (!deps.capacityBillingOperationsEnabled()) {
    throw new CapacityPlanCheckoutError(
      "Capacity billing operations are disabled",
      503,
      "operations_disabled"
    );
  }
  assertAccountCanSubscribe(input.account);
  const { plan, interval, returnPath } = resolveRequest(input.request);
  const catalogPrice = plan.prices[interval];
  const priceId = await deps.resolvePriceId(catalogPrice.lookupKey);
  const customerId = await deps.ensureCustomer(input.account, input.actorEmail);
  const metadata = {
    kind: "individual_plan",
    catalog_version: CAPACITY_CATALOG_VERSION,
    billing_account_id: input.account.id,
    plan_code: plan.code,
    plan_interval: interval,
    price_lookup_key: catalogPrice.lookupKey,
    max_named_users: String(plan.maxNamedUsers),
  };
  const session = await deps.createCheckoutSession(
    {
      mode: "subscription",
      customer: customerId,
      client_reference_id: input.account.id,
      line_items: [{ price: priceId, quantity: 1 }],
      managed_payments: { enabled: true },
      billing_address_collection: "auto",
      metadata,
      subscription_data: { metadata },
      success_url: deps.appUrl(billingResultPath(returnPath, "plan-submitted")),
      cancel_url: deps.appUrl(billingResultPath(returnPath, "cancelled")),
    },
    { idempotencyKey: individualPlanCheckoutIdempotencyKey(input.account) }
  );
  if (!session.url) {
    throw new CapacityPlanCheckoutError(
      "This checkout can no longer be used. Try again from billing settings.",
      409,
      "checkout_session_unavailable"
    );
  }
  return {
    status: "checkout_created",
    url: session.url,
    plan: {
      code: plan.code,
      name: plan.name,
      interval,
      amountCents: catalogPrice.amountCents,
      currency: "usd",
      maxNamedUsers: plan.maxNamedUsers,
    },
    entitlementStatus: "pending_webhook",
  };
}
