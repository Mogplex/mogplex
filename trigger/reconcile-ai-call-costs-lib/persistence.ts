import type {
  AiCallCostReconciliationDeps,
  AiCallCostReconciliationRow,
} from "./types";
import { gatewayCostUpdateFilter } from "./gateway";

// W7 intentionally drains at most 500 oldest rows per 10-minute run.
const BATCH_LIMIT = 500;
const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;
const GATEWAY_FINALIZATION_DELAY_MS = 30 * 1000;

export async function loadAiCallCostReconciliationRows(
  deps: Pick<AiCallCostReconciliationDeps, "supabase" | "now">
): Promise<AiCallCostReconciliationRow[]> {
  const now = deps.now();
  const windowStart = new Date(now.getTime() - RECONCILE_WINDOW_MS);
  const cutoff = new Date(now.getTime() - GATEWAY_FINALIZATION_DELAY_MS);

  // Select both the singleton and array columns. The array is preferred (W11),
  // but we fall back to the singleton for backward compatibility with rows
  // created before the array column was added.
  const { data, error } = await deps.supabase
    .from("ai_calls")
    .select(
      "id, user_id, model, gateway_generation_id, gateway_generation_ids, cost_source, completed_at, metadata"
    )
    .not("gateway_generation_id", "is", null)
    .isDistinct("cost_source", "gateway")
    .gt("completed_at", windowStart.toISOString())
    .lt("completed_at", cutoff.toISOString())
    .order("completed_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    throw new Error(
      `Failed to load ai_calls for cost reconciliation: ${error.message}`
    );
  }

  return (data ?? []) as AiCallCostReconciliationRow[];
}

export async function persistGatewayAiCallCost(
  deps: Pick<AiCallCostReconciliationDeps, "supabase">,
  input: {
    rowId: string;
    costUsd: number;
    generationId: string;
    generationIds: string[];
  }
): Promise<boolean> {
  const { data, error } = await deps.supabase
    .from("ai_calls")
    .update({
      cost_usd: input.costUsd,
      cost_source: "gateway",
      gateway_generation_id: input.generationId,
      // Also write the array column so rows that had NULL (created between deploy
      // and migration) get the correct IDs for any future re-reconciliation.
      gateway_generation_ids:
        input.generationIds.length > 0 ? input.generationIds : null,
    })
    .eq("id", input.rowId)
    // PostgREST ANDs this `or=(...)` query parameter with `id=eq.<rowId>`.
    .or(gatewayCostUpdateFilter(input.generationId))
    .select("id");

  if (error) {
    throw new Error(
      `Failed to persist Gateway cost for ai_call ${input.rowId}: ${error.message}`
    );
  }

  return (data ?? []).length > 0;
}
