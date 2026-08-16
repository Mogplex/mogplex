import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type {
  AppliedCapacityAnnualGrant,
  CapacityAnnualGrantSchedule,
} from "../../lib/billing/capacity-annual-grants";

async function loadTask() {
  return import("../../trigger/grant-capacity-annual-included-usage");
}

const CYCLE_START = new Date("2026-08-31T12:00:00.000Z");

function schedule(
  overrides: Partial<CapacityAnnualGrantSchedule> = {}
): CapacityAnnualGrantSchedule {
  return {
    id: "schedule-1",
    account_id: "account-1",
    stripe_subscription_id: "sub-1",
    entitlement_version: 4,
    price_lookup_key: "capacity_v2_plus_annual",
    included_usage_cents: 2_500,
    cycle_started_at: CYCLE_START.toISOString(),
    grant_offset: 1,
    grant_period: "2026-09",
    due_at: "2026-09-30T12:00:00.000Z",
    source_event_id: "evt-paid",
    runtime_run_id: "run-1",
    status: "pending",
    ...overrides,
  };
}

function applied(
  overrides: Partial<AppliedCapacityAnnualGrant> = {}
): AppliedCapacityAnnualGrant {
  return {
    eligible: true,
    posted: true,
    duplicate: false,
    cancelled: false,
    accountId: "account-1",
    subscriptionId: "sub-1",
    entitlementVersion: 4,
    priceLookupKey: "capacity_v2_plus_annual",
    includedUsageCents: 2_500,
    cycleStartedAt: CYCLE_START,
    occurrence: {
      offset: 1,
      period: "2026-09",
      dueAt: new Date("2026-09-30T12:00:00.000Z"),
    },
    sourceEventId: "evt-paid",
    ...overrides,
  };
}

function activeSubscription(): Stripe.Subscription {
  return {
    id: "sub-1",
    status: "active",
    items: {
      data: [{ price: { lookup_key: "capacity_v2_plus_annual" } }],
    },
  } as unknown as Stripe.Subscription;
}

function taskObservers() {
  const entries: Array<[string, unknown]> = [];
  const logs: unknown[] = [];
  const metadata = {
    set(key: string, value: unknown) {
      entries.push([key, value]);
      return metadata;
    },
  };
  return {
    entries,
    logs,
    metadata: metadata as never,
    logger: {
      log(message: string, data: unknown) {
        logs.push({ message, data });
      },
    },
  };
}

test("capacity annual grant task stays inert while Gate B is closed", async () => {
  const { runCapacityAnnualIncludedUsageGrant } = await loadTask();
  let loaded = false;
  const result = await runCapacityAnnualIncludedUsageGrant(
    { scheduleId: "schedule-1" },
    {
      operationsEnabled: () => false,
      getSchedule: async () => {
        loaded = true;
        return schedule();
      },
    }
  );

  assert.equal(loaded, false);
  assert.deepEqual(result, {
    disabled: true,
    cancelled: false,
    applied: null,
    nextScheduleDueAt: null,
  });
});

test("a provider-side subscription change cancels without granting", async () => {
  const { runCapacityAnnualIncludedUsageGrant } = await loadTask();
  const cancelled: string[] = [];
  let appliedSchedule = false;
  const result = await runCapacityAnnualIncludedUsageGrant(
    { scheduleId: "schedule-1" },
    {
      operationsEnabled: () => true,
      getSchedule: async () => schedule(),
      retrieveSubscription: async () => activeSubscription(),
      subscriptionIsCurrent: () => false,
      cancelSchedule: async (id) => {
        cancelled.push(id);
      },
      applySchedule: async () => {
        appliedSchedule = true;
        return applied();
      },
    }
  );

  assert.deepEqual(cancelled, ["schedule-1"]);
  assert.equal(appliedSchedule, false);
  assert.deepEqual(result, {
    disabled: false,
    cancelled: true,
    applied: null,
    nextScheduleDueAt: null,
  });
});

test("a cancelled database schedule avoids a Stripe lookup", async () => {
  const { runCapacityAnnualIncludedUsageGrant } = await loadTask();
  let retrieved = false;
  const result = await runCapacityAnnualIncludedUsageGrant(
    { scheduleId: "schedule-1" },
    {
      operationsEnabled: () => true,
      getSchedule: async () => schedule({ status: "cancel_pending" }),
      retrieveSubscription: async () => {
        retrieved = true;
        return activeSubscription();
      },
    }
  );

  assert.equal(retrieved, false);
  assert.equal(result.cancelled, true);
});

test("a successful grant schedules exactly the next monthly anchor", async () => {
  const { runCapacityAnnualIncludedUsageGrant } = await loadTask();
  const reconciliations: unknown[] = [];
  const observers = taskObservers();
  const grant = applied();
  const result = await runCapacityAnnualIncludedUsageGrant(
    { scheduleId: "schedule-1" },
    {
      operationsEnabled: () => true,
      getSchedule: async () => schedule(),
      retrieveSubscription: async () => activeSubscription(),
      subscriptionIsCurrent: () => true,
      applySchedule: async () => grant,
      reconcileSchedule: async (input) => {
        reconciliations.push(input);
        return null;
      },
      metadata: observers.metadata,
      logger: observers.logger,
    }
  );

  assert.deepEqual(reconciliations, [
    {
      accountId: "account-1",
      keepEntitlementVersion: 4,
      desired: {
        accountId: "account-1",
        subscriptionId: "sub-1",
        entitlementVersion: 4,
        priceLookupKey: "capacity_v2_plus_annual",
        includedUsageCents: 2_500,
        cycleStartedAt: CYCLE_START,
        occurrence: {
          offset: 2,
          period: "2026-10",
          dueAt: new Date("2026-10-31T12:00:00.000Z"),
        },
        sourceEventId: "evt-paid",
      },
    },
  ]);
  assert.equal(result.nextScheduleDueAt, "2026-10-31T12:00:00.000Z");
  assert.deepEqual(observers.entries, [
    ["billingAccountId", "account-1"],
    ["grantPeriod", "2026-09"],
    ["grantPosted", true],
    ["grantDuplicate", false],
    ["grantCancelled", false],
    ["nextScheduleDueAt", "2026-10-31T12:00:00.000Z"],
  ]);
  assert.equal(observers.logs.length, 1);
});

test("the eleventh monthly grant ends the annual chain", async () => {
  const { runCapacityAnnualIncludedUsageGrant } = await loadTask();
  let reconciled = false;
  const observers = taskObservers();
  const result = await runCapacityAnnualIncludedUsageGrant(
    { scheduleId: "schedule-11" },
    {
      operationsEnabled: () => true,
      getSchedule: async () => schedule({ id: "schedule-11" }),
      retrieveSubscription: async () => activeSubscription(),
      subscriptionIsCurrent: () => true,
      applySchedule: async () =>
        applied({
          occurrence: {
            offset: 11,
            period: "2027-07",
            dueAt: new Date("2027-07-31T12:00:00.000Z"),
          },
        }),
      reconcileSchedule: async () => {
        reconciled = true;
        return null;
      },
      metadata: observers.metadata,
      logger: observers.logger,
    }
  );

  assert.equal(reconciled, false);
  assert.equal(result.nextScheduleDueAt, null);
  assert.deepEqual(observers.entries.at(-1), ["nextScheduleDueAt", null]);
});
