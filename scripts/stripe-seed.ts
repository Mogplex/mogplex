// Idempotent Stripe catalog seed (pricing-plan 02 §2). Creates products and
// prices keyed by lookup_key so test and live mode stay in sync — never
// hand-create catalog objects in the dashboard. Safe to re-run: existing
// objects are left alone; an amount drift is corrected by creating a
// replacement price and transferring the lookup_key (prices are immutable).
//
// Usage: STRIPE_SECRET_KEY=sk_test_... pnpm exec tsx scripts/stripe-seed.ts [--dry-run]
import Stripe from "stripe";
import {
  PLAN_PRICES,
  TOPUP_PRESETS,
  TOPUP_PRODUCT_NAME,
} from "../lib/billing/catalog";

const dryRun = process.argv.includes("--dry-run");

type ProductSpec = { name: string; mogplexKey: string };

const PRODUCT_SPECS: ProductSpec[] = [
  ...[...new Set(PLAN_PRICES.map((plan) => plan.productName))].map((name) => ({
    name,
    mogplexKey: name.toLowerCase().replace(/\s+/g, "_"),
  })),
  { name: TOPUP_PRODUCT_NAME, mogplexKey: "usage_topup" },
];

async function ensureProducts(
  stripe: Stripe
): Promise<Map<string, Stripe.Product>> {
  const existing = new Map<string, Stripe.Product>();
  for await (const product of stripe.products.list({
    active: true,
    limit: 100,
  })) {
    const key = product.metadata.mogplex_key;
    if (key) existing.set(key, product);
  }

  const byName = new Map<string, Stripe.Product>();
  for (const spec of PRODUCT_SPECS) {
    const found = existing.get(spec.mogplexKey);
    if (found) {
      byName.set(spec.name, found);
      console.log(`product ok      ${spec.name} (${found.id})`);
      continue;
    }
    if (dryRun) {
      console.log(`product CREATE  ${spec.name}`);
      continue;
    }
    const created = await stripe.products.create({
      name: spec.name,
      metadata: { mogplex_key: spec.mogplexKey },
    });
    byName.set(spec.name, created);
    console.log(`product created ${spec.name} (${created.id})`);
  }
  return byName;
}

type PriceSpec = {
  lookupKey: string;
  productName: string;
  amountCents: number;
  interval?: "month" | "year";
  metadata: Record<string, string>;
};

function priceSpecs(): PriceSpec[] {
  return [
    ...PLAN_PRICES.map((plan) => ({
      lookupKey: plan.lookupKey,
      productName: plan.productName,
      amountCents: plan.amountCents,
      interval: plan.interval,
      metadata: {
        tier: plan.tier,
        included_usage_cents: String(plan.includedUsageCents),
      },
    })),
    ...TOPUP_PRESETS.map((preset) => ({
      lookupKey: preset.lookupKey,
      productName: TOPUP_PRODUCT_NAME,
      amountCents: preset.amountCents,
      metadata: { kind: "topup" },
    })),
  ];
}

async function ensurePrices(
  stripe: Stripe,
  products: Map<string, Stripe.Product>
) {
  const specs = priceSpecs();
  const existing = new Map<string, Stripe.Price>();
  const listed = await stripe.prices.list({
    lookup_keys: specs.map((spec) => spec.lookupKey),
    limit: 100,
  });
  for (const price of listed.data) {
    if (price.lookup_key) existing.set(price.lookup_key, price);
  }

  for (const spec of specs) {
    const current = existing.get(spec.lookupKey);
    const matches =
      current?.unit_amount === spec.amountCents &&
      current.currency === "usd" &&
      (current.recurring?.interval ?? undefined) === spec.interval;
    if (matches) {
      console.log(`price ok        ${spec.lookupKey} (${current.id})`);
      continue;
    }

    const action = current ? "REPLACE" : "CREATE";
    if (dryRun) {
      console.log(
        `price ${action}   ${spec.lookupKey} → $${(spec.amountCents / 100).toFixed(2)}${spec.interval ? `/${spec.interval}` : ""}`
      );
      continue;
    }
    const product = products.get(spec.productName);
    if (!product) {
      throw new Error(`missing product for ${spec.lookupKey}`);
    }
    const created = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: spec.amountCents,
      lookup_key: spec.lookupKey,
      // Moves the lookup_key off a drifted price; the old price stays for
      // existing subscriptions but is deactivated below.
      transfer_lookup_key: true,
      metadata: spec.metadata,
      ...(spec.interval ? { recurring: { interval: spec.interval } } : {}),
    });
    if (current) {
      await stripe.prices.update(current.id, { active: false });
      console.log(
        `price replaced  ${spec.lookupKey}: ${current.id} → ${created.id}`
      );
    } else {
      console.log(`price created   ${spec.lookupKey} (${created.id})`);
    }
  }
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is required");
    process.exit(1);
  }
  const stripe = new Stripe(key);
  const mode = key.startsWith("sk_live") ? "LIVE" : "test";
  console.log(
    `Seeding Stripe catalog (${mode} mode${dryRun ? ", dry run" : ""})\n`
  );

  const products = await ensureProducts(stripe);
  await ensurePrices(stripe, products);
  console.log("\nDone.");
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
