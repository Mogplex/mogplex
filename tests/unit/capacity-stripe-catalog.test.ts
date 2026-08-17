import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  CAPACITY_STRIPE_PRODUCTS,
  syncCapacityStripeCatalog,
  type CapacityStripeCatalogDeps,
} from "../../lib/billing/capacity-stripe-catalog";

type Product = {
  id: string;
  active: boolean;
  name: string;
  description: string;
  metadata: Record<string, string>;
};

type Price = {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number;
  lookup_key: string;
  product: string;
  recurring: { interval: string } | null;
};

function catalogDeps(input: {
  products?: Product[];
  prices?: Price[];
  calls?: string[];
}): CapacityStripeCatalogDeps {
  const products = input.products ?? [];
  const prices = input.prices ?? [];
  const calls = input.calls ?? [];
  return {
    async *listProducts() {
      calls.push("list-products");
      yield* products;
    },
    async createProduct(params, options) {
      calls.push(`create-product:${options.idempotencyKey}`);
      const product = {
        id: `prod_${products.length + 1}`,
        active: true,
        name: params.name,
        description: params.description ?? "",
        metadata: Object.fromEntries(
          Object.entries(params.metadata ?? {}).map(([key, value]) => [
            key,
            String(value),
          ])
        ),
      };
      products.push(product);
      return product;
    },
    async listPrices(params) {
      calls.push(`list-price:${params.lookup_keys?.[0]}`);
      return {
        data: prices.filter((price) =>
          params.lookup_keys?.includes(price.lookup_key)
        ),
      };
    },
    async createPrice(params, options) {
      calls.push(`create-price:${options.idempotencyKey}`);
      const price = {
        id: `price_${prices.length + 1}`,
        active: true,
        currency: params.currency,
        unit_amount: params.unit_amount!,
        lookup_key: params.lookup_key!,
        product: params.product!,
        recurring: params.recurring
          ? { interval: params.recurring.interval }
          : null,
      };
      prices.push(price);
      return price as unknown as Pick<Stripe.Price, "id">;
    },
  } as CapacityStripeCatalogDeps;
}

function materializedCatalog(): { products: Product[]; prices: Price[] } {
  const products: Product[] = [];
  const prices: Price[] = [];
  for (const [productIndex, spec] of CAPACITY_STRIPE_PRODUCTS.entries()) {
    const id = `prod_${productIndex + 1}`;
    products.push({
      id,
      active: true,
      name: spec.name,
      description: spec.description,
      metadata: {
        ...spec.metadata,
        mogplex_catalog_key: spec.catalogKey,
      },
    });
    for (const priceSpec of spec.prices) {
      prices.push({
        id: `price_${prices.length + 1}`,
        active: true,
        currency: "usd",
        unit_amount: priceSpec.amountCents,
        lookup_key: priceSpec.lookupKey,
        product: id,
        recurring: priceSpec.interval ? { interval: priceSpec.interval } : null,
      });
    }
  }
  return { products, prices };
}

async function withCapacityBillingEnvironment<T>(
  flag: string | undefined,
  key: string | undefined,
  run: () => Promise<T>
): Promise<T> {
  const originalFlag = process.env.CAPACITY_BILLING_OPERATIONS_ENABLED;
  const originalKey = process.env.STRIPE_SECRET_KEY;
  if (flag === undefined) {
    delete process.env.CAPACITY_BILLING_OPERATIONS_ENABLED;
  } else {
    process.env.CAPACITY_BILLING_OPERATIONS_ENABLED = flag;
  }
  if (key === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = key;
  }
  try {
    return await run();
  } finally {
    if (originalFlag === undefined) {
      delete process.env.CAPACITY_BILLING_OPERATIONS_ENABLED;
    } else {
      process.env.CAPACITY_BILLING_OPERATIONS_ENABLED = originalFlag;
    }
    if (originalKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalKey;
    }
  }
}

function withTestMode<T>(run: () => Promise<T>): Promise<T> {
  return withCapacityBillingEnvironment(
    "true",
    "sk_test_capacity_catalog",
    run
  );
}

test("capacity Stripe catalog uses the approved customer names and unique keys", () => {
  assert.deepEqual(
    CAPACITY_STRIPE_PRODUCTS.slice(0, 3).map((product) => product.name),
    ["Mogplex Pro", "Mogplex Plus", "Mogplex Max"]
  );
  assert.deepEqual(
    CAPACITY_STRIPE_PRODUCTS.slice(3).map((product) => product.name),
    [
      "Concurrency +10",
      "Concurrency +50",
      "Retained data +1 GB",
      "Retained data +10 GB",
      "Retained data +50 GB",
      "Retained data +100 GB",
      "Mogplex Hosted Usage",
    ]
  );
  const lookupKeys = CAPACITY_STRIPE_PRODUCTS.flatMap((product) =>
    product.prices.map((price) => price.lookupKey)
  );
  assert.equal(lookupKeys.length, 18);
  assert.equal(new Set(lookupKeys).size, lookupKeys.length);
});

test("capacity Stripe catalog seed creates the missing test catalog", async () => {
  const products: Product[] = [];
  const prices: Price[] = [];
  const result = await withTestMode(() =>
    syncCapacityStripeCatalog({
      deps: catalogDeps({ products, prices }),
    })
  );

  assert.deepEqual(result, {
    productsCreated: 10,
    productsReused: 0,
    pricesCreated: 18,
    pricesReused: 0,
  });
  assert.equal(products.length, 10);
  assert.equal(prices.length, 18);
});

test("capacity Stripe catalog seed is idempotent", async () => {
  const catalog = materializedCatalog();
  const result = await withTestMode(() =>
    syncCapacityStripeCatalog({
      deps: catalogDeps(catalog),
    })
  );

  assert.deepEqual(result, {
    productsCreated: 0,
    productsReused: 10,
    pricesCreated: 0,
    pricesReused: 18,
  });
});

test("capacity Stripe catalog seed refuses disabled writes before Stripe access", async () => {
  const calls: string[] = [];
  await withCapacityBillingEnvironment(undefined, undefined, () =>
    assert.rejects(
      syncCapacityStripeCatalog({
        deps: catalogDeps({ calls }),
      }),
      /operations are disabled/
    )
  );
  assert.deepEqual(calls, []);
});

test("capacity Stripe catalog seed fails closed on catalog drift", async () => {
  const catalog = materializedCatalog();
  catalog.products[0]!.name = "Wrong plan";
  await withTestMode(() =>
    assert.rejects(
      syncCapacityStripeCatalog({
        deps: catalogDeps(catalog),
      }),
      /does not match the local catalog/
    )
  );
});
