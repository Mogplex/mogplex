import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  applyCapacityAnnualGrantSchedule,
  bindCapacityAnnualGrantRuntimeRun,
  cancelCapacityAnnualGrantSchedule,
  capacityAnnualGrantOccurrence,
  capacityAnnualGrantScheduleInput,
  capacityAnnualSubscriptionIsCurrent,
  finalizeCapacityAnnualGrantCancellation,
  findOrCreateCapacityAnnualGrantSchedule,
  firstFutureCapacityAnnualGrantOccurrence,
  getCapacityAnnualGrantSchedule,
  nextCapacityAnnualGrantOccurrence,
  reconcileCapacityAnnualGrantSchedule,
  requestCapacityAnnualGrantCancellations,
  type CapacityAnnualGrantSchedule,
  type CapacityAnnualGrantScheduleInput,
} from "./capacity-annual-grants";

const CYCLE_START = new Date("2026-01-31T17:45:30.123Z");

function schedule(
  overrides: Partial<CapacityAnnualGrantSchedule> = {}
): CapacityAnnualGrantSchedule {
  return {
    id: "schedule-1",
    account_id: "account-1",
    stripe_subscription_id: "sub-1",
    entitlement_version: 3,
    price_lookup_key: "capacity_v2_pro_annual",
    included_usage_cents: 2_000,
    cycle_started_at: CYCLE_START.toISOString(),
    grant_offset: 1,
    grant_period: "2026-02",
    due_at: "2026-02-28T17:45:30.123Z",
    source_event_id: "evt-paid",
    runtime_run_id: null,
    status: "pending",
    ...overrides,
  };
}

function scheduleInput(
  overrides: Partial<CapacityAnnualGrantScheduleInput> = {}
): CapacityAnnualGrantScheduleInput {
  return {
    accountId: "account-1",
    subscriptionId: "sub-1",
    entitlementVersion: 3,
    priceLookupKey: "capacity_v2_pro_annual",
    includedUsageCents: 2_000,
    cycleStartedAt: CYCLE_START,
    occurrence: capacityAnnualGrantOccurrence(CYCLE_START, 1),
    sourceEventId: "evt-paid",
    ...overrides,
  };
}

function subscription(
  input: {
    id?: string;
    status?: Stripe.Subscription.Status;
    lookupKey?: string;
    cycleStart?: number;
  } = {}
): Stripe.Subscription {
  return {
    id: input.id ?? "sub-1",
    status: input.status ?? "active",
    items: {
      data: [
        {
          id: "si-plan",
          current_period_start:
            input.cycleStart ?? CYCLE_START.getTime() / 1_000,
          price: {
            lookup_key: input.lookupKey ?? "capacity_v2_pro_annual",
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

type DbResult = {
  data?: unknown;
  error?: { code?: string; message: string } | null;
};

function tableClient(results: DbResult[]) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const next = () => {
    const result = results.shift();
    if (!result) throw new Error("Missing fake database result");
    return Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
    });
  };
  const query = {
    insert(...args: unknown[]) {
      calls.push({ method: "insert", args });
      return query;
    },
    select(...args: unknown[]) {
      calls.push({ method: "select", args });
      return query;
    },
    update(...args: unknown[]) {
      calls.push({ method: "update", args });
      return query;
    },
    eq(...args: unknown[]) {
      calls.push({ method: "eq", args });
      return query;
    },
    is(...args: unknown[]) {
      calls.push({ method: "is", args });
      return query;
    },
    in(...args: unknown[]) {
      calls.push({ method: "in", args });
      return query;
    },
    single: next,
    maybeSingle: next,
    then(resolve: (result: { data: unknown; error: unknown }) => void) {
      return next().then(resolve);
    },
  };
  return {
    calls,
    client: {
      from(table: string) {
        calls.push({ method: "from", args: [table] });
        return query;
      },
    } as unknown as SupabaseClient,
  };
}

describe("capacity annual grant occurrence calculation", () => {
  it("clamps month-end anchors and preserves the UTC time", () => {
    expect(capacityAnnualGrantOccurrence(CYCLE_START, 1)).toEqual({
      offset: 1,
      period: "2026-02",
      dueAt: new Date("2026-02-28T17:45:30.123Z"),
    });
    expect(
      capacityAnnualGrantOccurrence(new Date("2028-01-31T00:00:00.000Z"), 1)
        .dueAt
    ).toEqual(new Date("2028-02-29T00:00:00.000Z"));
  });

  it("chooses only a future anchor and stops before annual renewal", () => {
    expect(
      firstFutureCapacityAnnualGrantOccurrence(
        CYCLE_START,
        new Date("2026-02-28T17:45:30.123Z")
      )
    ).toMatchObject({ offset: 2, period: "2026-03" });
    expect(
      nextCapacityAnnualGrantOccurrence({
        cycleStartedAt: CYCLE_START,
        currentOffset: 11,
      })
    ).toBeNull();
    expect(
      firstFutureCapacityAnnualGrantOccurrence(
        CYCLE_START,
        new Date("2027-01-31T17:45:30.123Z")
      )
    ).toBeNull();
  });

  it("rejects invalid dates and offsets", () => {
    expect(() => capacityAnnualGrantOccurrence(CYCLE_START, 0)).toThrow(
      /between 1 and 11/
    );
    expect(() =>
      firstFutureCapacityAnnualGrantOccurrence(
        CYCLE_START,
        new Date(Number.NaN)
      )
    ).toThrow(/boundary is invalid/);
  });
});

describe("capacity annual grant webhook input", () => {
  it("derives the first future occurrence from the paid plan item", () => {
    const stripeCycleStart = new Date("2026-01-31T17:45:30.000Z");
    expect(
      capacityAnnualGrantScheduleInput({
        accountId: "account-1",
        subscription: subscription({
          cycleStart: stripeCycleStart.getTime() / 1_000,
        }),
        entitlementVersion: 3,
        priceLookupKey: "capacity_v2_pro_annual",
        includedUsageCents: 2_000,
        sourceEventId: "evt-paid",
        eventCreatedAt: new Date("2026-02-28T17:45:30.123Z"),
      })
    ).toEqual({
      ...scheduleInput({
        cycleStartedAt: stripeCycleStart,
        occurrence: capacityAnnualGrantOccurrence(stripeCycleStart, 2),
      }),
    });
  });

  it("fails closed when the paid plan item has no valid cycle start", () => {
    const invalid = subscription();
    invalid.items.data[0]!.current_period_start = Number.NaN;
    expect(() =>
      capacityAnnualGrantScheduleInput({
        accountId: "account-1",
        subscription: invalid,
        entitlementVersion: 3,
        priceLookupKey: "capacity_v2_pro_annual",
        includedUsageCents: 2_000,
        sourceEventId: "evt-paid",
        eventCreatedAt: CYCLE_START,
      })
    ).toThrow(/missing its cycle start/);
  });

  it("validates the current provider subscription", () => {
    expect(
      capacityAnnualSubscriptionIsCurrent(schedule(), subscription())
    ).toBe(true);
    expect(
      capacityAnnualSubscriptionIsCurrent(
        schedule(),
        subscription({ status: "past_due" })
      )
    ).toBe(false);
    expect(
      capacityAnnualSubscriptionIsCurrent(
        schedule(),
        subscription({ lookupKey: "capacity_v2_plus_annual" })
      )
    ).toBe(false);
  });
});

describe("capacity annual grant persistence adapters", () => {
  it("creates and reads an exact schedule", async () => {
    const expected = schedule();
    const fake = tableClient([{ data: expected }, { data: expected }]);
    await expect(
      findOrCreateCapacityAnnualGrantSchedule(scheduleInput(), fake.client)
    ).resolves.toEqual(expected);
    await expect(
      getCapacityAnnualGrantSchedule(expected.id, fake.client)
    ).resolves.toEqual(expected);
    expect(fake.calls.filter((call) => call.method === "from")).toHaveLength(2);
  });

  it("reuses only an identical row after a unique conflict", async () => {
    const expected = schedule();
    const fake = tableClient([
      { error: { code: "23505", message: "duplicate" } },
      { data: expected },
    ]);
    await expect(
      findOrCreateCapacityAnnualGrantSchedule(scheduleInput(), fake.client)
    ).resolves.toEqual(expected);

    const conflict = tableClient([
      { error: { code: "23505", message: "duplicate" } },
      { data: schedule({ grant_period: "2026-03" }) },
    ]);
    await expect(
      findOrCreateCapacityAnnualGrantSchedule(scheduleInput(), conflict.client)
    ).rejects.toThrow(/idempotency conflict/);
  });

  it("rejects monthly prices and mismatched plan amounts", async () => {
    const fake = tableClient([]);
    await expect(
      findOrCreateCapacityAnnualGrantSchedule(
        scheduleInput({ priceLookupKey: "capacity_v2_pro_monthly" }),
        fake.client
      )
    ).rejects.toThrow(/non-annual price/);
    await expect(
      findOrCreateCapacityAnnualGrantSchedule(
        scheduleInput({ includedUsageCents: 501 }),
        fake.client
      )
    ).rejects.toThrow(/amount does not match/);
  });

  it("binds the Trigger run and rejects a conflicting binding", async () => {
    const bound = schedule({ runtime_run_id: "run-1" });
    const fake = tableClient([{ data: bound }]);
    await expect(
      bindCapacityAnnualGrantRuntimeRun("schedule-1", "run-1", fake.client)
    ).resolves.toEqual(bound);

    const conflict = tableClient([
      { data: null },
      { data: schedule({ runtime_run_id: "run-other" }) },
    ]);
    await expect(
      bindCapacityAnnualGrantRuntimeRun("schedule-1", "run-1", conflict.client)
    ).rejects.toThrow(/another runtime run/);
  });

  it("requests, finalizes, and directly records cancellations", async () => {
    const rows = [
      schedule({ runtime_run_id: "run-old", entitlement_version: 2 }),
      schedule({ id: "keep", entitlement_version: 3 }),
    ];
    const fake = tableClient([
      { data: rows },
      { data: null },
      {
        data: [
          schedule({
            runtime_run_id: "run-old",
            entitlement_version: 2,
            status: "cancel_pending",
          }),
        ],
      },
      { data: null },
      { data: null },
    ]);
    await expect(
      requestCapacityAnnualGrantCancellations("account-1", 3, fake.client)
    ).resolves.toEqual([
      expect.objectContaining({ id: "schedule-1", status: "cancel_pending" }),
    ]);
    await finalizeCapacityAnnualGrantCancellation("schedule-1", fake.client);
    await cancelCapacityAnnualGrantSchedule("schedule-1", fake.client);
    expect(fake.calls.filter((call) => call.method === "update")).toHaveLength(
      3
    );
  });

  it("maps the account-locked grant RPC result", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            eligible: true,
            posted: true,
            duplicate: false,
            cancelled: false,
            account_id: "account-1",
            stripe_subscription_id: "sub-1",
            entitlement_version: "3",
            price_lookup_key: "capacity_v2_pro_annual",
            included_usage_cents: "2000",
            cycle_started_at: CYCLE_START.toISOString(),
            grant_offset: 1,
            grant_period: "2026-02",
            due_at: "2026-02-28T17:45:30.123Z",
            source_event_id: "evt-paid",
          },
        ],
        error: null,
      }),
    } as unknown as SupabaseClient;
    await expect(
      applyCapacityAnnualGrantSchedule("schedule-1", client)
    ).resolves.toMatchObject({
      eligible: true,
      posted: true,
      entitlementVersion: 3,
      occurrence: { offset: 1, period: "2026-02" },
    });
  });
});

describe("capacity annual grant reconciliation", () => {
  it("cancels superseded delayed runs before enqueuing the desired row", async () => {
    const events: string[] = [];
    const desired = scheduleInput();
    const pending = schedule();
    const bound = schedule({ runtime_run_id: "run-new" });
    await expect(
      reconcileCapacityAnnualGrantSchedule(
        {
          accountId: "account-1",
          keepEntitlementVersion: 3,
          desired,
        },
        {
          requestCancellations: async () => [
            schedule({ id: "old-1", runtime_run_id: "run-old" }),
            schedule({ id: "old-2" }),
          ],
          cancelRun: async (id) => {
            events.push(`cancel:${id}`);
          },
          finalizeCancellation: async (id) => {
            events.push(`finalize:${id}`);
          },
          findOrCreateSchedule: async () => pending,
          enqueueSchedule: async () => {
            events.push("enqueue");
            return "run-new";
          },
          bindRuntimeRun: async () => bound,
        }
      )
    ).resolves.toEqual(bound);
    expect(events).toEqual([
      "cancel:run-old",
      "finalize:old-1",
      "finalize:old-2",
      "enqueue",
    ]);
  });

  it("does not enqueue an existing or unwanted schedule", async () => {
    const enqueue = vi.fn();
    const existing = schedule({ runtime_run_id: "run-existing" });
    await expect(
      reconcileCapacityAnnualGrantSchedule(
        {
          accountId: "account-1",
          keepEntitlementVersion: 3,
          desired: scheduleInput(),
        },
        {
          requestCancellations: async () => [],
          findOrCreateSchedule: async () => existing,
          enqueueSchedule: enqueue,
        }
      )
    ).resolves.toEqual(existing);
    expect(enqueue).not.toHaveBeenCalled();

    await expect(
      reconcileCapacityAnnualGrantSchedule(
        {
          accountId: "account-1",
          keepEntitlementVersion: null,
          desired: null,
        },
        { requestCancellations: async () => [] }
      )
    ).resolves.toBeNull();
  });

  it("cancels a newly bound run if the row lost its pending state", async () => {
    const cancelRun = vi.fn().mockResolvedValue(undefined);
    await reconcileCapacityAnnualGrantSchedule(
      {
        accountId: "account-1",
        keepEntitlementVersion: 3,
        desired: scheduleInput(),
      },
      {
        requestCancellations: async () => [],
        findOrCreateSchedule: async () => schedule(),
        enqueueSchedule: async () => "run-new",
        bindRuntimeRun: async () =>
          schedule({ runtime_run_id: "run-new", status: "cancel_pending" }),
        cancelRun,
      }
    );
    expect(cancelRun).toHaveBeenCalledWith("run-new");
  });

  it("rejects mismatched account and version inputs", async () => {
    const base = { requestCancellations: async () => [] };
    await expect(
      reconcileCapacityAnnualGrantSchedule(
        {
          accountId: "different",
          keepEntitlementVersion: 3,
          desired: scheduleInput(),
        },
        base
      )
    ).rejects.toThrow(/account does not match/);
    await expect(
      reconcileCapacityAnnualGrantSchedule(
        {
          accountId: "account-1",
          keepEntitlementVersion: 2,
          desired: scheduleInput(),
        },
        base
      )
    ).rejects.toThrow(/version does not match/);
  });
});
