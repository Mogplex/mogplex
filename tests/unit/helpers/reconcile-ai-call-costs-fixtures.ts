import assert from "node:assert/strict";
import type { AiCallCostReconciliationRow } from "../../../trigger/reconcile-ai-call-costs";

type ReconcileModule =
  typeof import("../../../trigger/reconcile-ai-call-costs");

export async function loadReconcileModule(): Promise<ReconcileModule> {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const reconcileModule =
    await import("../../../trigger/reconcile-ai-call-costs");
  return {
    ...reconcileModule,
    runAiCallCostReconciliation: (overrides) =>
      reconcileModule.runAiCallCostReconciliation({
        meterReconciledTokenUsage: async () => ({
          metered: true,
          reason: "posted",
          amountCents: 8,
          costUnits: 8_340_000,
        }),
        ...overrides,
      }),
  };
}

export function createRow(
  overrides: Partial<AiCallCostReconciliationRow> = {}
): AiCallCostReconciliationRow {
  return {
    id: "call_1",
    user_id: "user-1",
    model: "anthropic/claude-sonnet-4",
    gateway_generation_id: "gen_x",
    gateway_generation_ids: null,
    cost_source: "trigger",
    completed_at: "2026-05-16T10:00:00.000Z",
    metadata: null,
    ...overrides,
  };
}

export function createReconcileSupabase(
  rows: AiCallCostReconciliationRow[],
  options: {
    loadError?: string;
    updateRows?: Array<{ id: string }>;
  } = {}
) {
  const updates: Array<{
    payload: Record<string, unknown>;
    eq: [string, string];
    or: string;
    select: string;
  }> = [];

  const client = {
    from(table: string) {
      assert.equal(table, "ai_calls");
      const state: {
        updatePayload?: Record<string, unknown>;
        eq?: [string, string];
        or?: string;
      } = {};
      const builder = {
        select(columns: string) {
          if (state.updatePayload) {
            updates.push({
              payload: state.updatePayload,
              eq: state.eq!,
              or: state.or!,
              select: columns,
            });
            return Promise.resolve({
              data: options.updateRows ?? [{ id: state.eq![1] }],
              error: null,
            });
          }
          assert.equal(
            columns,
            "id, user_id, model, gateway_generation_id, gateway_generation_ids, cost_source, completed_at, metadata"
          );
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          assert.deepEqual(
            [column, operator, value],
            ["gateway_generation_id", "is", null]
          );
          return builder;
        },
        isDistinct(column: string, value: string) {
          assert.deepEqual([column, value], ["cost_source", "gateway"]);
          return builder;
        },
        gt(column: string, value: string) {
          assert.equal(column, "completed_at");
          assert.equal(typeof value, "string");
          return builder;
        },
        lt(column: string, value: string) {
          assert.equal(column, "completed_at");
          assert.equal(typeof value, "string");
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          assert.equal(column, "completed_at");
          assert.deepEqual(options, { ascending: true });
          return builder;
        },
        limit(limit: number) {
          assert.equal(limit, 500);
          if (options.loadError) {
            return Promise.resolve({
              data: null,
              error: { message: options.loadError },
            });
          }
          return Promise.resolve({ data: rows, error: null });
        },
        update(payload: Record<string, unknown>) {
          state.updatePayload = payload;
          return builder;
        },
        eq(column: string, value: string) {
          state.eq = [column, value];
          return builder;
        },
        or(filter: string) {
          state.or = filter;
          return builder;
        },
      };
      return builder;
    },
  };

  return { client, updates };
}
