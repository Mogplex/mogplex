import type { CapacityBillingSummaryV2 } from "@/lib/billing/capacity-summary-types";

export function capacitySummary(
  overrides: Partial<CapacityBillingSummaryV2> = {}
): CapacityBillingSummaryV2 {
  return {
    version: "capacity_v2",
    asOf: "2026-08-17T12:00:00.000Z",
    billingOperationsEnabled: true,
    concurrencyPurchasesEnabled: false,
    account: {
      id: "billing-account-1",
      eventSequence: "12",
      enforcementMode: "shadow",
      scope: "personal",
      displayName: "Alex",
      status: "active",
      canManageBilling: true,
      hasSubscription: true,
      hasBillingHistory: true,
    },
    plan: {
      ref: "plus",
      name: "Plus",
      offerKind: "individual",
      interval: "month",
      recurringAmountCents: 10_000,
      renewsAt: "2026-09-17T12:00:00.000Z",
      cancelsAt: null,
      namedUserLimit: 1,
    },
    billingDetails: null,
    concurrency: {
      active: 7,
      included: 25,
      addOn: 10,
      limit: 35,
      wouldBlock: false,
    },
    retainedData: {
      logicalBytes: "2300000000",
      includedBytes: "5000000000",
      addOnBytes: "0",
      limitBytes: "5000000000",
      percentUsed: 46,
      wouldBlock: false,
      overLimitAfterPendingChange: false,
    },
    hostedUsage: {
      includedRemainingCents: 1_800,
      purchasedRemainingCents: 1_000,
      openReservationsCents: 300,
      spendableCents: 2_500,
      grantResetsAt: "2026-09-17T12:00:00.000Z",
      purchasesFrozen: false,
    },
    addOns: [
      {
        subscriptionItemId: "si_concurrency",
        lookupKey: "capacity_v2_concurrency_10_monthly",
        kind: "concurrency",
        name: "Parallel agent runs +10",
        quantity: 1,
        allowanceDelta: "10",
        recurringAmountCents: 500,
        status: "active",
        effectiveAt: "2026-08-17T12:00:00.000Z",
      },
    ],
    openReservations: [],
    recentCosts: [
      {
        operationId: "operation-1",
        description: "Run customer report",
        status: "settled",
        occurredAt: "2026-08-16T12:00:00.000Z",
        totalCents: 74,
        items: [{ category: "trigger", label: "Trigger.dev", amountCents: 74 }],
      },
    ],
    ...overrides,
  };
}
