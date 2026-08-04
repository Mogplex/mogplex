import type Stripe from "stripe";
import {
  updateBillingAccount,
  type BillingAccount,
} from "@/lib/billing/accounts";
import { getStripe } from "@/lib/billing/stripe";

type StripeProductSummary = Pick<Stripe.Product, "id" | "metadata">;

export type StripeCheckoutDeps = {
  createCustomer: (
    params: Stripe.CustomerCreateParams,
    options?: Stripe.RequestOptions
  ) => Promise<Pick<Stripe.Customer, "id">>;
  listProducts: (
    params: Stripe.ProductListParams
  ) => AsyncIterable<StripeProductSummary>;
  updateAccountCustomer: (
    accountId: string,
    stripeCustomerId: string
  ) => Promise<void>;
};

function defaultDeps(): StripeCheckoutDeps {
  const stripe = getStripe();
  return {
    createCustomer: (params, options) =>
      stripe.customers.create(params, options),
    listProducts: (params) => stripe.products.list(params),
    updateAccountCustomer: (accountId, stripeCustomerId) =>
      updateBillingAccount(accountId, {
        stripe_customer_id: stripeCustomerId,
      }),
  };
}

export async function ensureStripeCustomer(
  account: BillingAccount,
  deps: StripeCheckoutDeps = defaultDeps()
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
  deps: StripeCheckoutDeps = defaultDeps()
): Promise<string> {
  for await (const product of deps.listProducts({ active: true, limit: 100 })) {
    if (product.metadata.mogplex_key === "usage_topup") return product.id;
  }
  throw new Error("Stripe top-up product not found — catalog is not seeded");
}

export function subscriptionCheckoutIdempotencyKey(
  account: BillingAccount,
  plan: string
): string {
  // period_anchor changes after a completed subscription, so a later genuine
  // re-subscribe gets a new key while concurrent first-subscribe requests do
  // not create two Checkout sessions.
  return `billing-subscribe:${account.id}:${account.period_anchor ?? "new"}:${plan}`;
}
