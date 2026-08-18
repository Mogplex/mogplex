import type Stripe from "stripe";
import {
  CAPACITY_ADD_ONS,
  CAPACITY_CATALOG_VERSION,
  CAPACITY_HOSTED_USAGE_PRESETS,
  INDIVIDUAL_CAPACITY_PLANS,
  type CapacityPlanInterval,
} from "@/lib/billing/capacity-catalog";
import { areCapacityBillingOperationsEnabled } from "@/lib/billing/stripe";

export type CapacityStripePriceSpec = {
  lookupKey: string;
  amountCents: number;
  interval: CapacityPlanInterval | null;
};

export type CapacityStripeProductSpec = {
  catalogKey: string;
  name: string;
  description: string;
  metadata: Record<string, string>;
  prices: readonly CapacityStripePriceSpec[];
};

const PLAN_DESCRIPTIONS = {
  pro: "Includes 5 Concurrency, 1 GB Storage, and $20 monthly Inference at dollar-for-dollar value.",
  plus: "Includes 25 Concurrency, 5 GB Storage, and $100 monthly Inference at dollar-for-dollar value.",
  max: "Includes 50 Concurrency, 10 GB Storage, and $200 monthly Inference at dollar-for-dollar value.",
} as const;

const planProducts = Object.values(INDIVIDUAL_CAPACITY_PLANS).map(
  (plan): CapacityStripeProductSpec => ({
    catalogKey: `${CAPACITY_CATALOG_VERSION}_plan_${plan.code}`,
    name: `Mogplex ${plan.name}`,
    description: PLAN_DESCRIPTIONS[plan.code],
    metadata: {
      catalog_version: CAPACITY_CATALOG_VERSION,
      kind: "plan",
      plan_code: plan.code,
      audience: plan.audience,
      max_named_users: String(plan.maxNamedUsers),
      concurrency: String(plan.concurrency),
      retained_data_bytes: String(plan.retainedDataBytes),
      included_hosted_usage_cents: String(plan.hostedUsageCents),
    },
    prices: Object.values(plan.prices),
  })
);

const addOnProducts = CAPACITY_ADD_ONS.map(
  (addOn): CapacityStripeProductSpec => {
    const allowanceDelta =
      addOn.kind === "concurrency"
        ? String(addOn.concurrencyDelta)
        : String(addOn.retainedDataBytesDelta);
    return {
      catalogKey: `${CAPACITY_CATALOG_VERSION}_addon_${addOn.lookupKey.replace(
        `${CAPACITY_CATALOG_VERSION}_`,
        ""
      )}`,
      name: addOn.name,
      description:
        addOn.kind === "concurrency"
          ? "Add more Concurrency without changing your plan."
          : "Keep more optional run history, logs, snapshots, artifacts, and uploads.",
      metadata: {
        catalog_version: CAPACITY_CATALOG_VERSION,
        kind: "capacity_addon",
        addon_kind: addOn.kind,
        allowance_delta: allowanceDelta,
      },
      prices: [
        {
          lookupKey: addOn.lookupKey,
          amountCents: addOn.amountCents,
          interval: addOn.interval,
        },
      ],
    };
  }
);

const hostedUsageProduct: CapacityStripeProductSpec = {
  catalogKey: `${CAPACITY_CATALOG_VERSION}_hosted_usage`,
  name: "Mogplex Inference",
  description:
    "Pay $1. Get $1 of inference credit. Purchased credit does not expire.",
  metadata: {
    catalog_version: CAPACITY_CATALOG_VERSION,
    kind: "hosted_usage",
    balance_bucket: "purchased",
    expires: "never",
  },
  prices: CAPACITY_HOSTED_USAGE_PRESETS.map((preset) => ({
    lookupKey: preset.lookupKey,
    amountCents: preset.chargeCents,
    interval: null,
  })),
};

export const CAPACITY_STRIPE_PRODUCTS: readonly CapacityStripeProductSpec[] = [
  ...planProducts,
  ...addOnProducts,
  hostedUsageProduct,
];

type ProductSummary = Pick<
  Stripe.Product,
  "id" | "active" | "name" | "description" | "metadata"
>;
type PriceSummary = Pick<
  Stripe.Price,
  "id" | "active" | "currency" | "unit_amount" | "lookup_key" | "product"
> & { recurring: { interval: string } | null };

export type CapacityStripeCatalogDeps = {
  listProducts: (
    params: Stripe.ProductListParams
  ) => AsyncIterable<ProductSummary>;
  createProduct: (
    params: Stripe.ProductCreateParams,
    options: Stripe.RequestOptions
  ) => Promise<Pick<Stripe.Product, "id">>;
  updateProduct: (
    id: string,
    params: Stripe.ProductUpdateParams
  ) => Promise<Pick<Stripe.Product, "id">>;
  listPrices: (
    params: Stripe.PriceListParams
  ) => Promise<{ data: PriceSummary[] }>;
  createPrice: (
    params: Stripe.PriceCreateParams,
    options: Stripe.RequestOptions
  ) => Promise<Pick<Stripe.Price, "id">>;
};

export type CapacityStripeCatalogSync = {
  productsCreated: number;
  productsUpdated: number;
  productsReused: number;
  pricesCreated: number;
  pricesReused: number;
};

function metadataMatches(
  actual: Stripe.Metadata,
  expected: Record<string, string>
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => actual[key] === value
  );
}

function productMatches(
  product: ProductSummary,
  spec: CapacityStripeProductSpec
): boolean {
  return (
    product.active &&
    product.name === spec.name &&
    product.description === spec.description &&
    metadataMatches(product.metadata, spec.metadata)
  );
}

function assertPriceMatches(
  price: PriceSummary,
  spec: CapacityStripePriceSpec,
  productId: string
) {
  const priceProductId =
    typeof price.product === "string" ? price.product : price.product.id;
  if (
    !price.active ||
    price.lookup_key !== spec.lookupKey ||
    price.currency !== "usd" ||
    price.unit_amount !== spec.amountCents ||
    (price.recurring?.interval ?? null) !== spec.interval ||
    priceProductId !== productId
  ) {
    throw new Error(
      `Stripe price ${spec.lookupKey} does not match the local catalog`
    );
  }
}

export function capacityStripeCatalogDeps(
  stripe: Stripe
): CapacityStripeCatalogDeps {
  return {
    listProducts: (params) => stripe.products.list(params),
    createProduct: (params, options) => stripe.products.create(params, options),
    updateProduct: (id, params) => stripe.products.update(id, params),
    listPrices: (params) => stripe.prices.list(params),
    createPrice: (params, options) => stripe.prices.create(params, options),
  };
}

function priceCreateParams(
  spec: CapacityStripePriceSpec,
  productId: string
): Stripe.PriceCreateParams {
  return {
    product: productId,
    lookup_key: spec.lookupKey,
    currency: "usd",
    unit_amount: spec.amountCents,
    ...(spec.interval ? { recurring: { interval: spec.interval } } : {}),
    metadata: { catalog_version: CAPACITY_CATALOG_VERSION },
  };
}

export async function syncCapacityStripeCatalog(input: {
  deps: CapacityStripeCatalogDeps;
}): Promise<CapacityStripeCatalogSync> {
  if (!areCapacityBillingOperationsEnabled()) {
    throw new Error("Capacity billing operations are disabled");
  }

  const productsByKey = new Map<string, ProductSummary>();
  for await (const product of input.deps.listProducts({
    limit: 100,
  })) {
    const catalogKey = product.metadata.mogplex_catalog_key;
    if (!catalogKey) continue;
    if (productsByKey.has(catalogKey)) {
      throw new Error(`Stripe catalog has duplicate product key ${catalogKey}`);
    }
    productsByKey.set(catalogKey, product);
  }

  const result: CapacityStripeCatalogSync = {
    productsCreated: 0,
    productsUpdated: 0,
    productsReused: 0,
    pricesCreated: 0,
    pricesReused: 0,
  };
  for (const productSpec of CAPACITY_STRIPE_PRODUCTS) {
    const existingProduct = productsByKey.get(productSpec.catalogKey);
    let productId: string;
    if (existingProduct) {
      productId = existingProduct.id;
      if (productMatches(existingProduct, productSpec)) {
        result.productsReused += 1;
      } else {
        await input.deps.updateProduct(productId, {
          active: true,
          name: productSpec.name,
          description: productSpec.description,
          metadata: {
            ...productSpec.metadata,
            mogplex_catalog_key: productSpec.catalogKey,
          },
        });
        result.productsUpdated += 1;
      }
    } else {
      const product = await input.deps.createProduct(
        {
          name: productSpec.name,
          description: productSpec.description,
          metadata: {
            ...productSpec.metadata,
            mogplex_catalog_key: productSpec.catalogKey,
          },
        },
        { idempotencyKey: `capacity-catalog:product:${productSpec.catalogKey}` }
      );
      productId = product.id;
      result.productsCreated += 1;
    }

    for (const priceSpec of productSpec.prices) {
      const prices = await input.deps.listPrices({
        lookup_keys: [priceSpec.lookupKey],
        limit: 2,
      });
      if (prices.data.length > 1) {
        throw new Error(
          `Stripe catalog has duplicate price key ${priceSpec.lookupKey}`
        );
      }
      const existingPrice = prices.data[0];
      if (existingPrice) {
        assertPriceMatches(existingPrice, priceSpec, productId);
        result.pricesReused += 1;
        continue;
      }
      await input.deps.createPrice(priceCreateParams(priceSpec, productId), {
        idempotencyKey: `capacity-catalog:price:${priceSpec.lookupKey}`,
      });
      result.pricesCreated += 1;
    }
  }
  return result;
}
