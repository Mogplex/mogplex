import { readFileSync } from "node:fs";
import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPACITY_ADD_ONS,
  CAPACITY_CATALOG_VERSION,
  CAPACITY_HOSTED_USAGE_MAX_CENTS,
  CAPACITY_HOSTED_USAGE_MIN_CENTS,
  CAPACITY_HOSTED_USAGE_PRESETS,
  CONTRACT_CAPACITY_PLANS,
  INDIVIDUAL_CAPACITY_PLANS,
  LOGICAL_BYTES_PER_GB,
  calculateCapacityEntitlements,
  currentCapacityEntitlementItems,
  findCapacityAddOn,
  findCapacityHostedUsagePreset,
  findCapacityRecurringPrice,
  findIndividualCapacityPrice,
  type CapacityEntitlementItemVersion,
} from "./capacity-catalog";
import {
  CAPACITY_STRIPE_PRODUCTS,
  syncCapacityStripeCatalog,
  type CapacityStripeCatalogDeps,
} from "./capacity-stripe-catalog";

const NOW = new Date("2026-08-16T12:00:00.000Z");
const BILLING_ACCOUNT_EVENTS_MIGRATION = readFileSync(
  new URL(
    "../../neon/migrations/20260817020000_capacity_billing_account_events.sql",
    import.meta.url
  ),
  "utf8"
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("capacity pricing catalog", () => {
  it("pins the approved individual plan allowances and prices", () => {
    expect(INDIVIDUAL_CAPACITY_PLANS).toMatchObject({
      pro: {
        concurrency: 5,
        retainedDataBytes: LOGICAL_BYTES_PER_GB,
        hostedUsageCents: 2_000,
        prices: {
          month: { amountCents: 2_000 },
          year: { amountCents: 20_400 },
        },
      },
      plus: {
        concurrency: 25,
        retainedDataBytes: 5 * LOGICAL_BYTES_PER_GB,
        hostedUsageCents: 10_000,
        prices: {
          month: { amountCents: 10_000 },
          year: { amountCents: 102_000 },
        },
      },
      max: {
        concurrency: 50,
        retainedDataBytes: 10 * LOGICAL_BYTES_PER_GB,
        hostedUsageCents: 20_000,
        prices: {
          month: { amountCents: 20_000 },
          year: { amountCents: 204_000 },
        },
      },
    });
    expect(CONTRACT_CAPACITY_PLANS.business.concurrency).toBeNull();
    expect(CONTRACT_CAPACITY_PLANS.enterprise.hostedUsageCents).toBeNull();
  });

  it("keeps billing failure events aligned with Individual plan codes", () => {
    const triggerClause = BILLING_ACCOUNT_EVENTS_MIGRATION.match(
      /new\.plan_code in \(([^)]+)\)/
    )?.[1];
    const triggerPlans = triggerClause?.match(/'[^']+'/g);
    expect(triggerPlans?.map((plan) => plan.slice(1, -1)).sort()).toEqual(
      Object.keys(INDIVIDUAL_CAPACITY_PLANS).sort()
    );
  });

  it("pins the approved recurring add-on schedule", () => {
    expect(
      CAPACITY_ADD_ONS.map((addOn) => [
        addOn.name,
        addOn.amountCents,
        addOn.concurrencyDelta,
        addOn.retainedDataBytesDelta / LOGICAL_BYTES_PER_GB,
      ])
    ).toEqual([
      ["Parallel agent runs +10", 500, 10, 0],
      ["Parallel agent runs +50", 1_500, 50, 0],
      ["Storage +1 GB", 200, 0, 1],
      ["Storage +10 GB", 1_500, 0, 10],
      ["Storage +50 GB", 6_000, 0, 50],
      ["Storage +100 GB", 10_000, 0, 100],
    ]);
  });

  it("pins face-value hosted-usage purchases and their guardrails", () => {
    expect(CAPACITY_HOSTED_USAGE_MIN_CENTS).toBe(100);
    expect(CAPACITY_HOSTED_USAGE_MAX_CENTS).toBe(100_000);
    expect(
      CAPACITY_HOSTED_USAGE_PRESETS.map((preset) => [
        preset.lookupKey,
        preset.creditCents,
        preset.chargeCents,
      ])
    ).toEqual([
      ["capacity_v2_hosted_usage_credit_1", 100, 100],
      ["capacity_v2_hosted_usage_credit_10", 1_000, 1_000],
      ["capacity_v2_hosted_usage_credit_25", 2_500, 2_500],
      ["capacity_v2_hosted_usage_credit_100", 10_000, 10_000],
      ["capacity_v2_hosted_usage_credit_250", 25_000, 25_000],
      ["capacity_v2_hosted_usage_credit_500", 50_000, 50_000],
      ["capacity_v2_hosted_usage_credit_1000", 100_000, 100_000],
    ]);
    expect(
      findCapacityHostedUsagePreset("capacity_v2_hosted_usage_credit_25")
    ).toMatchObject({ creditCents: 2_500, chargeCents: 2_500 });
    expect(findCapacityHostedUsagePreset("topup_25")).toBeNull();
  });

  it("seeds one-time hosted-usage prices without recurring terms", async () => {
    vi.stubEnv("CAPACITY_BILLING_OPERATIONS_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_capacity_catalog");
    const prices: Stripe.PriceCreateParams[] = [];
    const deps: CapacityStripeCatalogDeps = {
      async *listProducts() {},
      createProduct: async (params) =>
        ({
          id: `prod-${String(params.metadata?.mogplex_catalog_key)}`,
          active: true,
          name: params.name,
          description: params.description,
          metadata: params.metadata,
        }) as never,
      updateProduct: async () => ({ id: "unused" }),
      listPrices: async () => ({ data: [] }),
      createPrice: async (params) => {
        prices.push(params);
        return { id: `price-${prices.length}` };
      },
    };

    await expect(syncCapacityStripeCatalog({ deps })).resolves.toEqual({
      productsCreated: 10,
      productsUpdated: 0,
      productsReused: 0,
      pricesCreated: 19,
      pricesReused: 0,
    });
    const hostedKeys = new Set(
      CAPACITY_HOSTED_USAGE_PRESETS.map((preset) => preset.lookupKey)
    );
    const hostedPrices = prices.filter((price) =>
      hostedKeys.has(String(price.lookup_key))
    );
    expect(hostedPrices).toHaveLength(7);
    expect(hostedPrices.every((price) => price.recurring === undefined)).toBe(
      true
    );
    expect(CAPACITY_STRIPE_PRODUCTS).toHaveLength(10);
  });

  it("uses the latest effective item version and excludes future or zero quantity", () => {
    const versions: CapacityEntitlementItemVersion[] = [
      {
        itemRef: "concurrency",
        priceLookupKey: "capacity_v2_concurrency_10_monthly",
        quantity: 1,
        effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      {
        itemRef: "concurrency",
        priceLookupKey: "capacity_v2_concurrency_50_monthly",
        quantity: 2,
        effectiveAt: new Date("2026-08-15T00:00:00.000Z"),
      },
      {
        itemRef: "cancelled-storage",
        priceLookupKey: "capacity_v2_retained_data_1gb_monthly",
        quantity: 0,
        effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      {
        itemRef: "future-storage",
        priceLookupKey: "capacity_v2_retained_data_100gb_monthly",
        quantity: 1,
        effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ];

    expect(currentCapacityEntitlementItems(versions, NOW)).toEqual([
      versions[1],
    ]);
    expect(calculateCapacityEntitlements("pro", versions, NOW)).toEqual({
      catalogVersion: CAPACITY_CATALOG_VERSION,
      planCode: "pro",
      maxNamedUsers: 1,
      concurrency: 105,
      retainedDataBytes: LOGICAL_BYTES_PER_GB,
      hostedUsageCents: 2_000,
      recurringAddOnCents: 3_000,
      activeAddOns: [
        {
          itemRef: "concurrency",
          lookupKey: "capacity_v2_concurrency_50_monthly",
          name: "Parallel agent runs +50",
          quantity: 2,
          amountCents: 3_000,
        },
      ],
    });
  });

  it("rejects invalid quantities, unknown catalog items, and unsafe totals", () => {
    expect(() =>
      currentCapacityEntitlementItems(
        [
          {
            itemRef: "bad",
            priceLookupKey: "capacity_v2_concurrency_10_monthly",
            quantity: -1,
            effectiveAt: NOW,
          },
        ],
        NOW
      )
    ).toThrow(/invalid entitlement quantity/);
    expect(() =>
      calculateCapacityEntitlements(
        "pro",
        [
          {
            itemRef: "unknown",
            priceLookupKey: "unknown",
            quantity: 1,
            effectiveAt: NOW,
          },
        ],
        NOW
      )
    ).toThrow(/unknown capacity add-on/);
    expect(() =>
      calculateCapacityEntitlements(
        "pro",
        [
          {
            itemRef: "too-many",
            priceLookupKey: "capacity_v2_retained_data_100gb_monthly",
            quantity: Number.MAX_SAFE_INTEGER,
            effectiveAt: NOW,
          },
        ],
        NOW
      )
    ).toThrow(/safe integer range/);
  });

  it("finds add-ons by their stable lookup key", () => {
    expect(findCapacityAddOn("capacity_v2_concurrency_10_monthly")?.name).toBe(
      "Parallel agent runs +10"
    );
    expect(findCapacityAddOn("missing")).toBeNull();
  });

  it("resolves plan and add-on prices through one Stripe contract", () => {
    expect(
      findIndividualCapacityPrice("capacity_v2_plus_annual")
    ).toMatchObject({
      plan: { code: "plus" },
      price: { amountCents: 102_000, interval: "year" },
    });
    expect(
      findCapacityRecurringPrice("capacity_v2_concurrency_10_monthly")
    ).toEqual({ amountCents: 500, interval: "month" });
    expect(findCapacityRecurringPrice("unknown")).toBeNull();
  });
});
