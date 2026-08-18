import { describe, expect, it } from "vitest";
import { buildCapacityBillingSummary } from "./capacity-summary";
import type { CapacityBillingFacts } from "./capacity-summary-types";

const AS_OF = new Date("2026-08-16T12:30:00.000Z");

function capacityFacts(
  overrides: Partial<CapacityBillingFacts> = {}
): CapacityBillingFacts {
  return {
    account: {
      id: "account-1",
      billing_event_sequence: 12,
      owner_type: "user",
      tier: "pro",
      status: "active",
      period_anchor: "2026-08-16",
      plan_code: "pro",
      plan_audience: "individual",
      max_named_users: 1,
      included_concurrency: 5,
      included_retained_bytes: 1_000_000_000,
      entitlement_enforcement_mode: "shadow",
    },
    balance: {
      includedCents: 300,
      purchasedCents: 500,
      totalCents: 800,
    },
    activeConcurrency: 5,
    retainedLogicalBytes: "2000000000",
    entitlementItems: [
      {
        id: 1,
        item_ref: "plan-item",
        item_kind: "plan",
        price_lookup_key: "capacity_v2_pro_monthly",
        quantity: 1,
        effective_at: "2026-08-01T00:00:00.000Z",
        recorded_at: "2026-08-01T00:00:01.000Z",
      },
      {
        id: 2,
        item_ref: "concurrency-item",
        item_kind: "concurrency_addon",
        price_lookup_key: "capacity_v2_concurrency_10_monthly",
        quantity: 1,
        effective_at: "2026-08-02T00:00:00.000Z",
        recorded_at: "2026-08-02T00:00:01.000Z",
      },
      {
        id: 3,
        item_ref: "retained-item",
        item_kind: "retained_data_addon",
        price_lookup_key: "capacity_v2_retained_data_10gb_monthly",
        quantity: 1,
        effective_at: "2026-08-03T00:00:00.000Z",
        recorded_at: "2026-08-03T00:00:01.000Z",
      },
      {
        id: 4,
        item_ref: "retained-item",
        item_kind: "retained_data_addon",
        price_lookup_key: "capacity_v2_retained_data_10gb_monthly",
        quantity: 0,
        effective_at: "2026-09-01T00:00:00.000Z",
        recorded_at: "2026-08-10T00:00:01.000Z",
      },
    ],
    openReservations: [
      {
        reservation_ref: "reservation-1",
        operation_ref: "operation-open",
        reserved_micros: "15000",
        created_at: "2026-08-16T12:05:00.000Z",
      },
    ],
    costOperations: [
      {
        operation_ref: "operation-settled",
        retail_debit_micros: "17500",
        occurred_at: "2026-08-16T12:01:00.000Z",
      },
    ],
    costItems: [
      {
        operation_ref: "operation-settled",
        cost_source: "ai",
        retail_debit_micros: "12500",
        occurred_at: "2026-08-16T12:01:00.000Z",
      },
      {
        operation_ref: "operation-settled",
        cost_source: "trigger",
        retail_debit_micros: "5000",
        occurred_at: "2026-08-16T12:01:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("capacity billing summary", () => {
  it("returns customer capacity, spendable usage, pending add-ons, and retail costs", () => {
    const summary = buildCapacityBillingSummary({
      facts: capacityFacts(),
      scope: "personal",
      canManageBilling: true,
      billingOperationsEnabled: false,
      asOf: AS_OF,
    });

    expect(summary).toMatchObject({
      version: "capacity_v2",
      asOf: AS_OF.toISOString(),
      billingOperationsEnabled: false,
      account: {
        id: "account-1",
        eventSequence: "12",
        enforcementMode: "shadow",
        scope: "personal",
        displayName: "Personal workspace",
        status: "active",
        canManageBilling: true,
      },
      plan: {
        ref: "pro",
        name: "Pro",
        offerKind: "individual",
        interval: "month",
        recurringAmountCents: 2_000,
        renewsAt: "2026-09-16T00:00:00.000Z",
        namedUserLimit: 1,
      },
      concurrency: {
        active: 5,
        included: 5,
        addOn: 10,
        limit: 15,
        wouldBlock: false,
      },
      retainedData: {
        logicalBytes: "2000000000",
        includedBytes: "1000000000",
        addOnBytes: "10000000000",
        limitBytes: "11000000000",
        percentUsed: 18.1,
        wouldBlock: false,
        overLimitAfterPendingChange: true,
      },
      hostedUsage: {
        includedRemainingCents: 300,
        purchasedRemainingCents: 500,
        openReservationsCents: 2,
        spendableCents: 798,
        grantResetsAt: "2026-09-16T00:00:00.000Z",
        purchasesFrozen: false,
      },
    });
    expect(summary.addOns).toEqual([
      {
        subscriptionItemId: "concurrency-item",
        lookupKey: "capacity_v2_concurrency_10_monthly",
        kind: "concurrency",
        name: "Concurrency +10",
        quantity: 1,
        allowanceDelta: "10",
        recurringAmountCents: 500,
        status: "active",
        effectiveAt: "2026-08-02T00:00:00.000Z",
      },
      {
        subscriptionItemId: "retained-item",
        lookupKey: "capacity_v2_retained_data_10gb_monthly",
        kind: "retained_data",
        name: "Storage +10 GB",
        quantity: 0,
        allowanceDelta: "0",
        recurringAmountCents: 0,
        status: "cancels_at_period_end",
        effectiveAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
    expect(summary.openReservations).toEqual([
      {
        id: "reservation-1",
        operationKind: "hosted_work",
        description: "Hosted work in progress",
        reservedCents: 2,
        createdAt: "2026-08-16T12:05:00.000Z",
      },
    ]);
    expect(summary.recentCosts).toEqual([
      {
        operationId: "operation-open",
        description: "Hosted work in progress",
        status: "in_progress",
        occurredAt: "2026-08-16T12:05:00.000Z",
        totalCents: null,
        items: [],
      },
      {
        operationId: "operation-settled",
        description: "Hosted work",
        status: "settled",
        occurredAt: "2026-08-16T12:01:00.000Z",
        totalCents: 3,
        items: [
          { category: "ai", label: "AI", amountCents: 2 },
          {
            category: "trigger",
            label: "Workflow compute",
            amountCents: 1,
          },
        ],
      },
    ]);
  });

  it("does not invent public limits for legacy or unresolved contract accounts", () => {
    const facts = capacityFacts({
      account: {
        ...capacityFacts().account,
        tier: "business",
        status: "frozen_topups",
        plan_code: null,
        plan_audience: "legacy",
        included_concurrency: 0,
        included_retained_bytes: 0,
      },
      activeConcurrency: 50,
      retainedLogicalBytes: "9007199254740993000",
      entitlementItems: [],
      openReservations: [],
      costOperations: [],
      costItems: [],
    });
    const summary = buildCapacityBillingSummary({
      facts,
      scope: "team",
      canManageBilling: false,
      billingOperationsEnabled: false,
      asOf: AS_OF,
    });

    expect(summary.account).toMatchObject({
      scope: "team",
      status: "frozen_purchases",
      canManageBilling: false,
    });
    expect(summary.plan).toMatchObject({
      ref: "legacy",
      name: "Legacy Mog Mode",
      offerKind: "legacy",
    });
    expect(summary.concurrency).toMatchObject({
      active: 50,
      included: null,
      limit: null,
      wouldBlock: false,
    });
    expect(summary.retainedData).toMatchObject({
      logicalBytes: "9007199254740993000",
      includedBytes: null,
      limitBytes: null,
      percentUsed: null,
      wouldBlock: false,
    });
  });

  it("fails closed on unknown entitlement catalog rows", () => {
    const facts = capacityFacts({
      entitlementItems: [
        {
          id: 1,
          item_ref: "unknown",
          item_kind: "concurrency_addon",
          price_lookup_key: "unknown-price",
          quantity: 1,
          effective_at: "2026-08-01T00:00:00.000Z",
          recorded_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    expect(() =>
      buildCapacityBillingSummary({
        facts,
        scope: "personal",
        canManageBilling: true,
        billingOperationsEnabled: false,
        asOf: AS_OF,
      })
    ).toThrow(/unknown capacity add-on/);
  });

  it("uses the last recorded version at the next effective instant", () => {
    const facts = capacityFacts({
      entitlementItems: [
        {
          id: 1,
          item_ref: "concurrency-item",
          item_kind: "concurrency_addon",
          price_lookup_key: "capacity_v2_concurrency_10_monthly",
          quantity: 1,
          effective_at: "2026-08-01T00:00:00.000Z",
          recorded_at: "2026-08-01T00:00:00.000Z",
        },
        {
          id: 2,
          item_ref: "concurrency-item",
          item_kind: "concurrency_addon",
          price_lookup_key: "capacity_v2_concurrency_50_monthly",
          quantity: 1,
          effective_at: "2026-09-01T00:00:00.000Z",
          recorded_at: "2026-08-12T10:00:00.000Z",
        },
        {
          id: 3,
          item_ref: "concurrency-item",
          item_kind: "concurrency_addon",
          price_lookup_key: "capacity_v2_concurrency_10_monthly",
          quantity: 1,
          effective_at: "2026-09-01T00:00:00.000Z",
          recorded_at: "2026-08-12T11:00:00.000Z",
        },
      ],
      openReservations: [],
      costOperations: [],
      costItems: [],
    });

    const summary = buildCapacityBillingSummary({
      facts,
      scope: "personal",
      canManageBilling: true,
      billingOperationsEnabled: false,
      asOf: AS_OF,
    });

    expect(summary.concurrency).toMatchObject({ addOn: 10, limit: 15 });
    expect(summary.addOns).toEqual([
      expect.objectContaining({
        lookupKey: "capacity_v2_concurrency_10_monthly",
        allowanceDelta: "10",
        status: "active",
      }),
    ]);
  });

  it("rounds each open reservation up before calculating spendable cents", () => {
    const summary = buildCapacityBillingSummary({
      facts: capacityFacts({
        balance: { includedCents: 1, purchasedCents: 0, totalCents: 1 },
        openReservations: [
          {
            reservation_ref: "reservation-1",
            operation_ref: "operation-1",
            reserved_micros: "5000",
            created_at: "2026-08-16T12:00:00.000Z",
          },
          {
            reservation_ref: "reservation-2",
            operation_ref: "operation-2",
            reserved_micros: "5000",
            created_at: "2026-08-16T12:01:00.000Z",
          },
        ],
        costOperations: [],
        costItems: [],
      }),
      scope: "personal",
      canManageBilling: true,
      billingOperationsEnabled: false,
      asOf: AS_OF,
    });

    expect(summary.hostedUsage).toMatchObject({
      openReservationsCents: 2,
      spendableCents: 0,
    });
    expect(summary.openReservations.map((item) => item.reservedCents)).toEqual([
      1, 1,
    ]);
  });

  it("fails closed when an operation total does not match its cost items", () => {
    expect(() =>
      buildCapacityBillingSummary({
        facts: capacityFacts({
          costOperations: [
            {
              operation_ref: "operation-settled",
              retail_debit_micros: "18000",
              occurred_at: "2026-08-16T12:01:00.000Z",
            },
          ],
        }),
        scope: "personal",
        canManageBilling: true,
        billingOperationsEnabled: false,
        asOf: AS_OF,
      })
    ).toThrow(/retail cost operation does not match its items/);
  });

  it("does not invent a renewal date from an invalid period anchor", () => {
    const summary = buildCapacityBillingSummary({
      facts: capacityFacts({
        account: {
          ...capacityFacts().account,
          period_anchor: "2026-02-31",
        },
      }),
      scope: "personal",
      canManageBilling: true,
      billingOperationsEnabled: false,
      asOf: AS_OF,
    });

    expect(summary.plan.renewsAt).toBeNull();
    expect(summary.hostedUsage.grantResetsAt).toBeNull();
  });
});
