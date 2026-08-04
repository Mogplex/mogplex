import type Stripe from "stripe";
import {
  updateBillingAccount,
  type BillingAccount,
} from "@/lib/billing/accounts";
import { getStripe } from "@/lib/billing/stripe";
import { findPlanPrice, findTopupPreset } from "@/lib/billing/catalog";

type StripeProductSummary = Pick<Stripe.Product, "id" | "metadata">;
type StripePriceSummary = Pick<
  Stripe.Price,
  "id" | "active" | "unit_amount" | "currency"
> & {
  recurring: { interval: string } | null;
};

export type StripeCustomerDeps = {
  createCustomer: (
    params: Stripe.CustomerCreateParams,
    options?: Stripe.RequestOptions
  ) => Promise<Pick<Stripe.Customer, "id">>;
  updateAccountCustomer: (
    accountId: string,
    stripeCustomerId: string
  ) => Promise<void>;
};

export type StripeProductDeps = {
  listProducts: (
    params: Stripe.ProductListParams
  ) => AsyncIterable<StripeProductSummary>;
};

export type ListStripePrices = (
  params: Stripe.PriceListParams
) => Promise<{ data: StripePriceSummary[] }>;

function defaultCustomerDeps(): StripeCustomerDeps {
  const stripe = getStripe();
  return {
    createCustomer: (params, options) =>
      stripe.customers.create(params, options),
    updateAccountCustomer: (accountId, stripeCustomerId) =>
      updateBillingAccount(accountId, {
        stripe_customer_id: stripeCustomerId,
      }),
  };
}

function defaultProductDeps(): StripeProductDeps {
  return {
    listProducts: (params) => getStripe().products.list(params),
  };
}

const topupProductLookups = new WeakMap<StripeProductDeps, Promise<string>>();
const sharedProductDeps = defaultProductDeps();

export async function ensureStripeCustomer(
  account: BillingAccount,
  deps: StripeCustomerDeps = defaultCustomerDeps()
): Promise<string> {
  if (account.stripe_customer_id) return account.stripe_customer_id;
  const customer = await deps.createCustomer(
    { metadata: { billing_account_id: account.id } },
    // Concurrent requests for a new account collapse to the same Stripe
    // customer instead of creating an orphan and racing the DB linkage.
    { idempotencyKey: `billing-customer:${account.id}` }
  );
  await deps.updateAccountCustomer(account.id, customer.id);
  return customer.id;
}

// Custom-amount top-ups reference the seeded shared product so each session
// doesn't mint an orphan ad-hoc Product in the Stripe catalog. Stripe's list
// promise is async-iterable, so this remains correct beyond the first page.
export async function resolveTopupProductId(
  deps: StripeProductDeps = sharedProductDeps
): Promise<string> {
  const cached = topupProductLookups.get(deps);
  if (cached) return cached;

  const lookup = (async () => {
    for await (const product of deps.listProducts({
      active: true,
      limit: 100,
    })) {
      if (product.metadata.mogplex_key === "usage_topup") return product.id;
    }
    throw new Error("Stripe top-up product not found — catalog is not seeded");
  })();
  // Successful lookups remain cached until this runtime instance recycles.
  // Replacing the seeded product therefore requires recycling warm instances.
  topupProductLookups.set(deps, lookup);
  try {
    return await lookup;
  } catch (error) {
    topupProductLookups.delete(deps);
    throw error;
  }
}

export async function resolveCatalogPriceId(
  lookupKey: string,
  listPrices: ListStripePrices = (params) => getStripe().prices.list(params)
): Promise<string> {
  const prices = await listPrices({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) {
    throw new Error(
      `Stripe price for lookup_key "${lookupKey}" not found — catalog is not seeded`
    );
  }

  const plan = findPlanPrice(lookupKey);
  const preset = findTopupPreset(lookupKey);
  const expectedAmount = plan?.amountCents ?? preset?.amountCents;
  const matches =
    expectedAmount !== undefined &&
    price.active &&
    price.currency === "usd" &&
    price.unit_amount === expectedAmount &&
    (plan ? price.recurring?.interval === plan.interval : !price.recurring);
  if (!matches) {
    throw new Error(
      `Stripe price for lookup_key "${lookupKey}" does not match the local catalog`
    );
  }
  return price.id;
}

export function subscriptionCheckoutIdempotencyKey(
  account: BillingAccount
): string {
  // Concurrent requests share one key. The cancellation RPC advances this
  // generation exactly once per subscription, so a later re-subscribe cannot
  // replay an old session without unrelated account updates splitting races.
  const generation = account.subscription_checkout_generation ?? 0;
  return `billing-subscribe:${account.id}:${generation}`;
}

export function topupCheckoutIdempotencyKey(
  accountId: string,
  attemptId: string
): string {
  return `billing-topup:${accountId}:${attemptId}`;
}
