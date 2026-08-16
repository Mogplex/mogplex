import { describe, expect, it } from "vitest";
import {
  CAPACITY_ADD_ONS,
  CAPACITY_CATALOG_VERSION,
  CONTRACT_CAPACITY_PLANS,
  INDIVIDUAL_CAPACITY_PLANS,
  LOGICAL_BYTES_PER_GB,
  calculateCapacityEntitlements,
  currentCapacityEntitlementItems,
  findCapacityAddOn,
  type CapacityEntitlementItemVersion,
} from "./capacity-catalog";

const NOW = new Date("2026-08-16T12:00:00.000Z");

describe("capacity pricing catalog", () => {
  it("pins the approved individual plan allowances and prices", () => {
    expect(INDIVIDUAL_CAPACITY_PLANS).toMatchObject({
      pro: {
        concurrency: 5,
        retainedDataBytes: LOGICAL_BYTES_PER_GB,
        hostedUsageCents: 500,
        prices: {
          month: { amountCents: 2_000 },
          year: { amountCents: 20_400 },
        },
      },
      plus: {
        concurrency: 25,
        retainedDataBytes: 5 * LOGICAL_BYTES_PER_GB,
        hostedUsageCents: 2_500,
        prices: {
          month: { amountCents: 10_000 },
          year: { amountCents: 102_000 },
        },
      },
      max: {
        concurrency: 50,
        retainedDataBytes: 10 * LOGICAL_BYTES_PER_GB,
        hostedUsageCents: 5_000,
        prices: {
          month: { amountCents: 20_000 },
          year: { amountCents: 204_000 },
        },
      },
    });
    expect(CONTRACT_CAPACITY_PLANS.business.concurrency).toBeNull();
    expect(CONTRACT_CAPACITY_PLANS.enterprise.hostedUsageCents).toBeNull();
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
      ["Concurrency +10", 500, 10, 0],
      ["Concurrency +50", 1_500, 50, 0],
      ["Retained data +1 GB", 200, 0, 1],
      ["Retained data +10 GB", 1_500, 0, 10],
      ["Retained data +50 GB", 6_000, 0, 50],
      ["Retained data +100 GB", 10_000, 0, 100],
    ]);
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
      hostedUsageCents: 500,
      recurringAddOnCents: 3_000,
      activeAddOns: [
        {
          itemRef: "concurrency",
          lookupKey: "capacity_v2_concurrency_50_monthly",
          name: "Concurrency +50",
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
      "Concurrency +10"
    );
    expect(findCapacityAddOn("missing")).toBeNull();
  });
});
