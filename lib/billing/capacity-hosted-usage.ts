import type Stripe from "stripe";
import type { BillingAccount } from "@/lib/billing/accounts";
import {
  CAPACITY_CATALOG_VERSION,
  CAPACITY_HOSTED_USAGE_MAX_CENTS,
  CAPACITY_HOSTED_USAGE_MIN_CENTS,
  findCapacityHostedUsagePreset,
} from "@/lib/billing/capacity-catalog";
import {
  areCapacityBillingOperationsEnabled,
  getStripe,
} from "@/lib/billing/stripe";
import {
  ensureStripeCustomer,
  resolveCatalogPriceId,
} from "@/lib/billing/stripe-checkout";
import { sanitizeReturnPath } from "@/lib/billing/checkout";

export const CAPACITY_HOSTED_USAGE_PRODUCT_KEY = `${CAPACITY_CATALOG_VERSION}_hosted_usage`;

const CHECKOUT_ATTEMPT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class HostedUsagePurchaseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "HostedUsagePurchaseError";
  }
}

export type HostedUsageCheckoutRequest = {
  preset?: string;
  amountCents?: number;
  attemptId: string;
  returnPath: string;
};

export type HostedUsageCheckoutValidation =
  | { ok: true; value: HostedUsageCheckoutRequest }
  | { ok: false; error: string };

type HostedUsageChoiceValidation =
  | {
      ok: true;
      value: Pick<HostedUsageCheckoutRequest, "preset" | "amountCents">;
    }
  | { ok: false; error: string };

export type HostedUsageCheckoutResult = {
  status: "checkout_created";
  url: string;
  creditCents: number;
  subtotalCents: number;
  currency: "usd";
  balanceStatus: "pending_webhook";
};

type ProductSummary = Pick<Stripe.Product, "id" | "active" | "metadata">;

export type CapacityHostedUsageProductDeps = {
  listProducts: (
    params: Stripe.ProductListParams
  ) => AsyncIterable<ProductSummary>;
};

export type HostedUsageCheckoutDeps = {
  capacityBillingOperationsEnabled: () => boolean;
  ensureCustomer: (
    account: BillingAccount,
    actorEmail: string | null
  ) => Promise<string>;
  resolvePriceId: (lookupKey: string) => Promise<string>;
  resolveProductId: () => Promise<string>;
  createCheckoutSession: (
    params: Stripe.Checkout.SessionCreateParams,
    options: Stripe.RequestOptions
  ) => Promise<Pick<Stripe.Checkout.Session, "id" | "url">>;
  appUrl: (path: string) => string;
};

function validateHostedUsageChoice(input: {
  preset: unknown;
  amountCents: unknown;
}): HostedUsageChoiceValidation {
  const hasPreset = input.preset !== undefined;
  const hasCustomAmount = input.amountCents !== undefined;
  if (hasPreset === hasCustomAmount) {
    return {
      ok: false,
      error: "Choose one hosted-usage preset or custom amount",
    };
  }
  if (hasPreset) {
    if (
      typeof input.preset !== "string" ||
      !findCapacityHostedUsagePreset(input.preset)
    ) {
      return { ok: false, error: "Unknown hosted-usage preset" };
    }
    return { ok: true, value: { preset: input.preset } };
  }
  if (!Number.isSafeInteger(input.amountCents)) {
    return { ok: false, error: "Hosted-usage amount must be integer cents" };
  }
  const amountCents = input.amountCents as number;
  if (amountCents < CAPACITY_HOSTED_USAGE_MIN_CENTS) {
    return { ok: false, error: "The minimum hosted-usage purchase is $10" };
  }
  if (amountCents > CAPACITY_HOSTED_USAGE_MAX_CENTS) {
    return {
      ok: false,
      error: "Hosted-usage purchases above $1,000 require support",
    };
  }
  return { ok: true, value: { amountCents } };
}

export function validateHostedUsageCheckoutRequest(
  body: unknown
): HostedUsageCheckoutValidation {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid request body" };
  }
  const { preset, amountCents, attemptId, returnPath } = body as {
    preset?: unknown;
    amountCents?: unknown;
    attemptId?: unknown;
    returnPath?: unknown;
  };
  if (typeof attemptId !== "string" || !CHECKOUT_ATTEMPT_ID.test(attemptId)) {
    return { ok: false, error: "Invalid checkout attempt" };
  }
  const choice = validateHostedUsageChoice({ preset, amountCents });
  if (!choice.ok) return choice;
  return {
    ok: true,
    value: {
      ...choice.value,
      attemptId,
      returnPath: sanitizeReturnPath(returnPath),
    },
  };
}

export function hostedUsageCheckoutIdempotencyKey(
  accountId: string,
  attemptId: string
): string {
  if (!accountId || !CHECKOUT_ATTEMPT_ID.test(attemptId)) {
    throw new TypeError("Invalid hosted-usage checkout idempotency scope");
  }
  return `capacity-hosted-usage:${accountId}:${attemptId}`;
}

const productLookups = new WeakMap<
  CapacityHostedUsageProductDeps,
  Promise<string>
>();

export async function resolveCapacityHostedUsageProductId(
  deps: CapacityHostedUsageProductDeps
): Promise<string> {
  const cached = productLookups.get(deps);
  if (cached) return cached;
  const lookup = (async () => {
    let productId: string | null = null;
    for await (const product of deps.listProducts({
      active: true,
      limit: 100,
    })) {
      if (
        product.metadata.mogplex_catalog_key !==
        CAPACITY_HOSTED_USAGE_PRODUCT_KEY
      ) {
        continue;
      }
      if (productId) {
        throw new Error("Stripe has duplicate hosted-usage products");
      }
      productId = product.id;
    }
    if (!productId) {
      throw new Error("Stripe hosted-usage product is not seeded");
    }
    return productId;
  })();
  productLookups.set(deps, lookup);
  try {
    return await lookup;
  } catch (error) {
    productLookups.delete(deps);
    throw error;
  }
}

const sharedProductDeps: CapacityHostedUsageProductDeps = {
  listProducts: (params) => getStripe().products.list(params),
};

function defaultCheckoutDeps(): HostedUsageCheckoutDeps {
  if (!areCapacityBillingOperationsEnabled()) {
    throw new HostedUsagePurchaseError(
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
    resolveProductId: () =>
      resolveCapacityHostedUsageProductId(sharedProductDeps),
    createCheckoutSession: (params, options) =>
      stripe.checkout.sessions.create(params, options),
    appUrl: (path) => {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://mogplex.com";
      return `${base.replace(/\/$/, "")}${path}`;
    },
  };
}

function assertAccountCanBuyHostedUsage(account: BillingAccount) {
  if (
    account.owner_type !== "user" ||
    (account.plan_code !== "pro" &&
      account.plan_code !== "plus" &&
      account.plan_code !== "max")
  ) {
    throw new HostedUsagePurchaseError(
      "Hosted-usage checkout is available for Individual plans. Contact sales for a company contract.",
      409,
      "self_service_unavailable"
    );
  }
  if (account.status === "frozen_topups") {
    throw new HostedUsagePurchaseError(
      "This account cannot buy hosted usage now. Contact support for help.",
      403,
      "purchases_frozen"
    );
  }
  if (account.status !== "active") {
    throw new HostedUsagePurchaseError(
      "Hosted-usage purchases are unavailable until the billing account is active",
      409,
      "account_inactive"
    );
  }
  if (!account.stripe_customer_id || !account.stripe_subscription_id) {
    throw new HostedUsagePurchaseError(
      "An active Individual subscription is required",
      409,
      "subscription_required"
    );
  }
}

function billingResultPath(returnPath: string, result: string): string {
  const separator = returnPath.includes("?") ? "&" : "?";
  return `${returnPath}${separator}billing=${result}`;
}

function hostedUsageCreditCents(request: HostedUsageCheckoutRequest): number {
  const choice = validateHostedUsageChoice({
    preset: request.preset,
    amountCents: request.amountCents,
  });
  if (!choice.ok) {
    throw new HostedUsagePurchaseError(
      "The hosted-usage purchase is invalid",
      400,
      "invalid_amount"
    );
  }
  const preset = request.preset
    ? findCapacityHostedUsagePreset(request.preset)
    : null;
  const amount = preset?.creditCents ?? request.amountCents;
  if (
    !Number.isSafeInteger(amount) ||
    amount! < CAPACITY_HOSTED_USAGE_MIN_CENTS ||
    amount! > CAPACITY_HOSTED_USAGE_MAX_CENTS
  ) {
    throw new HostedUsagePurchaseError(
      "The hosted-usage purchase is invalid",
      400,
      "invalid_amount"
    );
  }
  return amount!;
}

async function hostedUsageLineItem(input: {
  request: HostedUsageCheckoutRequest;
  creditCents: number;
  deps: HostedUsageCheckoutDeps;
}): Promise<Stripe.Checkout.SessionCreateParams.LineItem> {
  if (input.request.preset) {
    return {
      price: await input.deps.resolvePriceId(input.request.preset),
      quantity: 1,
    };
  }
  return {
    price_data: {
      currency: "usd",
      product: await input.deps.resolveProductId(),
      unit_amount: input.creditCents,
    },
    quantity: 1,
  };
}

export async function createHostedUsageCheckout(input: {
  account: BillingAccount;
  actorEmail: string | null;
  request: HostedUsageCheckoutRequest;
  deps?: HostedUsageCheckoutDeps;
}): Promise<HostedUsageCheckoutResult> {
  const deps = input.deps ?? defaultCheckoutDeps();
  if (!deps.capacityBillingOperationsEnabled()) {
    throw new HostedUsagePurchaseError(
      "Capacity billing operations are disabled",
      503,
      "operations_disabled"
    );
  }
  assertAccountCanBuyHostedUsage(input.account);
  const creditCents = hostedUsageCreditCents(input.request);
  const idempotencyKey = hostedUsageCheckoutIdempotencyKey(
    input.account.id,
    input.request.attemptId
  );
  const returnPath = sanitizeReturnPath(input.request.returnPath);
  const customerId = await deps.ensureCustomer(input.account, input.actorEmail);
  const lineItem = await hostedUsageLineItem({
    request: input.request,
    creditCents,
    deps,
  });
  const metadata = {
    kind: "hosted_usage",
    catalog_version: CAPACITY_CATALOG_VERSION,
    billing_account_id: input.account.id,
    credit_cents: String(creditCents),
    checkout_attempt_id: input.request.attemptId,
  };
  const session = await deps.createCheckoutSession(
    {
      mode: "payment",
      customer: customerId,
      client_reference_id: input.account.id,
      line_items: [lineItem],
      managed_payments: { enabled: true },
      billing_address_collection: "auto",
      payment_intent_data: { metadata },
      metadata,
      success_url: deps.appUrl(
        billingResultPath(returnPath, "hosted-usage-submitted")
      ),
      cancel_url: deps.appUrl(billingResultPath(returnPath, "cancelled")),
    },
    {
      idempotencyKey,
    }
  );
  if (!session.url) {
    throw new HostedUsagePurchaseError(
      "This checkout can no longer be used. Try again to start a new checkout.",
      409,
      "checkout_session_unavailable"
    );
  }
  return {
    status: "checkout_created",
    url: session.url,
    creditCents,
    subtotalCents: creditCents,
    currency: "usd",
    balanceStatus: "pending_webhook",
  };
}
