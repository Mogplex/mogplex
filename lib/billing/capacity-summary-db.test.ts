import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCapacityBillingSummary } from "./capacity-summary-db";

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

type QueryCall = {
  table: string;
  selected?: string;
  selectOptions?: unknown;
  filters: Array<[string, unknown]>;
  orders: Array<[string, unknown]>;
  limit?: number;
};

function fakeClient(overrides: Partial<Record<string, QueryResult>> = {}): {
  client: SupabaseClient;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const defaults: Record<string, QueryResult> = {
    billing_accounts: {
      data: {
        id: "account-1",
        billing_event_sequence: "7",
        owner_type: "user",
        tier: "pro",
        status: "active",
        period_anchor: "2026-08-16",
        plan_code: "pro",
        plan_audience: "individual",
        max_named_users: 1,
        included_concurrency: 5,
        included_retained_bytes: "1000000000",
        entitlement_enforcement_mode: "shadow",
      },
      error: null,
    },
    billing_active_workflow_capacity_leases: {
      data: null,
      error: null,
      count: 3,
    },
    billing_retained_data_totals: {
      data: { logical_bytes: "250000000" },
      error: null,
    },
    billing_entitlement_items: {
      data: [
        {
          id: 1,
          item_ref: "plan-1",
          item_kind: "plan",
          price_lookup_key: "capacity_v2_pro_monthly",
          quantity: 1,
          effective_at: "2026-08-01T00:00:00.000Z",
          recorded_at: "2026-08-01T00:00:01.000Z",
        },
      ],
      error: null,
      count: 1,
    },
    billing_open_cost_reservations: { data: [], error: null, count: 0 },
    billing_customer_retail_cost_operations: {
      data: [
        {
          operation_ref: "operation-1",
          retail_debit_micros: "17500",
          occurred_at: "2026-08-16T11:59:00.000Z",
          description: "Code review · Mogplex/mogplex #285",
        },
      ],
      error: null,
    },
    billing_customer_retail_cost_items: {
      data: [
        {
          operation_ref: "operation-1",
          cost_source: "ai",
          retail_debit_micros: "12500",
          occurred_at: "2026-08-16T11:59:00.000Z",
        },
        {
          operation_ref: "operation-1",
          cost_source: "trigger",
          retail_debit_micros: "5000",
          occurred_at: "2026-08-16T11:59:00.000Z",
        },
      ],
      error: null,
      count: 2,
    },
  };

  const client = {
    from(table: string) {
      const call: QueryCall = { table, filters: [], orders: [] };
      calls.push(call);
      const result = overrides[table] ?? defaults[table]!;
      const query = {
        select(columns: string, options?: unknown) {
          call.selected = columns;
          call.selectOptions = options;
          return query;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return query;
        },
        in(column: string, values: unknown[]) {
          call.filters.push([column, values]);
          return query;
        },
        order(column: string, options?: unknown) {
          call.orders.push([column, options]);
          return query;
        },
        limit(value: number) {
          call.limit = value;
          return query;
        },
        maybeSingle() {
          return Promise.resolve(result);
        },
        then(resolve: (value: QueryResult) => unknown) {
          return Promise.resolve(result).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe("capacity billing summary database loader", () => {
  it("loads only account-scoped customer retail facts", async () => {
    const { client, calls } = fakeClient();
    const summary = await loadCapacityBillingSummary({
      accountId: "account-1",
      balance: { includedCents: 500, purchasedCents: 200, totalCents: 700 },
      scope: "personal",
      canManageBilling: true,
      billingOperationsEnabled: false,
      asOf: new Date("2026-08-16T12:00:00.000Z"),
      client,
    });

    expect(summary).toMatchObject({
      account: {
        id: "account-1",
        eventSequence: "7",
        enforcementMode: "shadow",
        canManageBilling: true,
      },
      concurrency: { active: 3, included: 5, limit: 5 },
      retainedData: {
        logicalBytes: "250000000",
        includedBytes: "1000000000",
      },
      hostedUsage: { spendableCents: 700 },
    });
    expect(summary.recentCosts).toEqual([
      expect.objectContaining({
        operationId: "operation-1",
        status: "settled",
        description: "Code review · Mogplex/mogplex #285",
        totalCents: 2,
      }),
    ]);
    expect(calls).toHaveLength(7);
    for (const call of calls) {
      expect(call.filters).toContainEqual([
        call.table === "billing_accounts" ? "id" : "account_id",
        "account-1",
      ]);
    }
    expect(
      calls.find(
        (call) => call.table === "billing_customer_retail_cost_operations"
      )
    ).toMatchObject({
      filters: [["account_id", "account-1"]],
      limit: 20,
      selected: "operation_ref, retail_debit_micros, occurred_at, description",
    });
    expect(
      calls.find((call) => call.table === "billing_customer_retail_cost_items")
    ).toMatchObject({
      filters: [
        ["account_id", "account-1"],
        ["operation_ref", ["operation-1"]],
      ],
      limit: 240,
    });
    expect(
      calls.some((call) => call.table === "billing_provider_cost_events")
    ).toBe(false);
    expect(
      calls.find(
        (call) => call.table === "billing_active_workflow_capacity_leases"
      )?.selectOptions
    ).toEqual({ count: "exact", head: true });
    expect(
      calls.find((call) => call.table === "billing_entitlement_items")
        ?.selectOptions
    ).toEqual({ count: "exact" });
    expect(
      calls.find((call) => call.table === "billing_open_cost_reservations")
        ?.selectOptions
    ).toEqual({ count: "exact" });
    expect(
      calls.find((call) => call.table === "billing_customer_retail_cost_items")
        ?.selectOptions
    ).toEqual({ count: "exact" });
  });

  it("fails closed when a required billing projection is unavailable", async () => {
    const { client } = fakeClient({
      billing_customer_retail_cost_operations: {
        data: null,
        error: { message: "provider relation unavailable" },
      },
    });

    await expect(
      loadCapacityBillingSummary({
        accountId: "account-1",
        balance: { includedCents: 0, purchasedCents: 0, totalCents: 0 },
        scope: "personal",
        canManageBilling: false,
        billingOperationsEnabled: false,
        client,
      })
    ).rejects.toThrow(/recent cost operation lookup failed/);
  });

  it("fails closed instead of returning a truncated reservation total", async () => {
    const { client } = fakeClient({
      billing_open_cost_reservations: {
        data: [],
        error: null,
        count: 501,
      },
    });

    await expect(
      loadCapacityBillingSummary({
        accountId: "account-1",
        balance: { includedCents: 1_000, purchasedCents: 0, totalCents: 1_000 },
        scope: "personal",
        canManageBilling: true,
        billingOperationsEnabled: false,
        client,
      })
    ).rejects.toThrow(/open reservation lookup exceeded its safe result limit/);
  });
});
