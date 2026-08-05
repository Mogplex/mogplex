import * as Sentry from "@sentry/nextjs";
import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import { meterReconciledTokenUsage } from "@/lib/billing/token-usage";
import { createObservabilityGatewayClient } from "@/lib/observability/gateway-client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

// W7 intentionally drains at most 500 oldest rows per 10-minute run.
const BATCH_LIMIT = 500;
// Keep full batches inside the Trigger maxDuration without firing 500 Gateway calls at once.
const RECONCILE_CONCURRENCY = 20;
const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;
const GATEWAY_FINALIZATION_DELAY_MS = 30 * 1000;
const STALE_WARNING_MS = 12 * 60 * 60 * 1000;

export type AiCallCostReconciliationRow = {
  id: string;
  user_id: string;
  model: string;
  /** @deprecated Use gateway_generation_ids array instead. Kept for backward compat. */
  gateway_generation_id: string;
  /** All gateway generation IDs across tool-loop steps. W11 sums cost across all. */
  gateway_generation_ids: string[] | null;
  cost_source: "trigger" | "gateway" | "manual" | null;
  completed_at: string;
  metadata: Record<string, unknown> | null;
};

export type AiCallCostReconciliationSummary = {
  scanned: number;
  reconciled: number;
  skipped: number;
  errored: number;
};

type GatewayGenerationInfoClient = {
  getGenerationInfo: (params: { id: string }) => Promise<unknown>;
};

type SentryClient = {
  captureException: (
    exception: unknown,
    captureContext?: Parameters<typeof Sentry.captureException>[1]
  ) => unknown;
  captureMessage: (
    message: string,
    captureContext?: Parameters<typeof Sentry.captureMessage>[1]
  ) => unknown;
};

type AiCallCostReconciliationDeps = {
  gateway?: GatewayGenerationInfoClient;
  supabase: typeof supabaseAdmin;
  sentry: SentryClient;
  now: () => Date;
  meterReconciledTokenUsage: typeof meterReconciledTokenUsage;
};

type AiCallCostReconciliationOutcome = "reconciled" | "skipped" | "errored";

const defaultDeps: AiCallCostReconciliationDeps = {
  supabase: supabaseAdmin,
  sentry: Sentry,
  now: () => new Date(),
  meterReconciledTokenUsage,
};

function getGatewayCost(info: unknown): number | null {
  if (!info || typeof info !== "object") return null;
  const value =
    "totalCost" in info
      ? info.totalCost
      : "cost" in info
        ? info.cost
        : undefined;

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 404
  );
}

function shouldWarnStale(row: AiCallCostReconciliationRow, now: Date) {
  const completedAt = Date.parse(row.completed_at);
  return (
    Number.isFinite(completedAt) &&
    now.getTime() - completedAt > STALE_WARNING_MS
  );
}

function captureStaleWarning(
  deps: Pick<AiCallCostReconciliationDeps, "sentry">,
  row: AiCallCostReconciliationRow,
  reason: string,
  diagnostic?: { resolvedCount: number; totalCount: number }
) {
  deps.sentry.captureMessage(
    "[ai-cost-reconciliation] row still unreconciled",
    {
      level: "warning",
      extra: {
        ai_call_id: row.id,
        gateway_generation_id: row.gateway_generation_id,
        gateway_generation_ids: row.gateway_generation_ids,
        completed_at: row.completed_at,
        reason,
        // For multi-ID rows, include how many IDs resolved vs total so on-call
        // can distinguish 'billing not finalized yet' from 'permanent data gap'.
        ...(diagnostic
          ? {
              resolved_count: diagnostic.resolvedCount,
              total_count: diagnostic.totalCount,
            }
          : {}),
      },
    }
  );
}

/**
 * Get the effective list of generation IDs to reconcile for a row.
 * Prefers the array column (W11) but falls back to the singleton (W7).
 *
 * Note: Downstream callers must route through `gatewayCostUpdateFilter` before
 * any PostgREST interpolation. That function validates the ID format via the
 * regex `/^[A-Za-z0-9_-]+$/` to prevent injection.
 */
function getEffectiveGenerationIds(row: AiCallCostReconciliationRow): string[] {
  if (row.gateway_generation_ids && row.gateway_generation_ids.length > 0) {
    return row.gateway_generation_ids;
  }
  return row.gateway_generation_id ? [row.gateway_generation_id] : [];
}

function captureUpdateGuardNoop(
  deps: Pick<AiCallCostReconciliationDeps, "sentry">,
  row: AiCallCostReconciliationRow,
  generationId: string
) {
  deps.sentry.captureMessage(
    "[ai-cost-reconciliation] update guard skipped row",
    {
      level: "info",
      extra: {
        ai_call_id: row.id,
        gateway_generation_id: row.gateway_generation_id,
        gateway_generation_ids: row.gateway_generation_ids,
        gateway_generation_id_returned: generationId,
        cost_source: row.cost_source,
      },
    }
  );
}

/**
 * Fetch cost from Gateway for multiple generation IDs and sum them.
 * Returns null if any ID returns 404 (incomplete data).
 * Throws on other errors.
 *
 * Parallel fetch — happy path is one RTT regardless of step count.
 * Trade-off: a row that will skip on its first 404 still spends API calls on
 * the remaining IDs. Acceptable because 404s on multi-step rows are rare (all
 * IDs are written atomically) and the latency win on the common case dominates.
 */
type AggregateGatewayCostResult =
  | { status: "complete"; totalCost: number; firstId: string }
  | {
      status: "incomplete";
      reason: "not_found" | "missing_cost";
      resolvedCount: number;
      totalCount: number;
    };

async function fetchAggregateGatewayCost(
  gateway: GatewayGenerationInfoClient,
  generationIds: string[]
): Promise<AggregateGatewayCostResult | null> {
  if (generationIds.length === 0) {
    return null;
  }

  // Fetch all generation info in parallel
  const results = await Promise.allSettled(
    generationIds.map((id) => gateway.getGenerationInfo({ id }))
  );

  let totalCost = 0;
  let resolvedCount = 0;
  let anyMissingCost = false;
  let anyNotFound = false;

  for (const result of results) {
    if (result.status === "rejected") {
      if (isNotFoundError(result.reason)) {
        anyNotFound = true;
      } else {
        throw result.reason;
      }
    } else {
      // Count HTTP 200 responses as resolved, regardless of whether cost is present.
      // This makes resolved_count consistent across both incomplete paths: 404s vs missing cost.
      resolvedCount += 1;
      const cost = getGatewayCost(result.value);
      if (cost === null) {
        anyMissingCost = true;
      } else {
        totalCost += cost;
      }
    }
  }

  // If any ID returned 404 or has no cost yet, we have incomplete data.
  // Skip this row entirely until all IDs are ready to avoid partial sums.
  if (anyNotFound) {
    return {
      status: "incomplete",
      reason: "not_found",
      resolvedCount,
      totalCount: generationIds.length,
    };
  }
  if (anyMissingCost) {
    return {
      status: "incomplete",
      reason: "missing_cost",
      resolvedCount,
      totalCount: generationIds.length,
    };
  }

  // Round to 8 decimal places to match the NUMERIC(14, 8) column type and avoid
  // IEEE-754 floating-point summation artifacts (e.g. 0.05 + 0.08 + 0.04 = 0.16999999999999998).
  const roundedCost = Math.round(totalCost * 1e8) / 1e8;

  return {
    status: "complete",
    totalCost: roundedCost,
    firstId: generationIds[0],
  };
}

function gatewayCostUpdateFilter(generationId: string) {
  // Supabase .or() accepts raw PostgREST syntax, so only interpolate literal-safe ids.
  if (!/^[A-Za-z0-9_-]+$/.test(generationId)) {
    throw new Error("Invalid Gateway generation id for ai_call cost update");
  }

  return `cost_source.isdistinct.gateway,gateway_generation_id.isdistinct.${generationId}`;
}

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

async function reconcileAiCallCostRow(
  deps: Pick<
    AiCallCostReconciliationDeps,
    "supabase" | "sentry" | "meterReconciledTokenUsage"
  >,
  gateway: GatewayGenerationInfoClient,
  row: AiCallCostReconciliationRow,
  now: Date
): Promise<AiCallCostReconciliationOutcome> {
  const generationIds = getEffectiveGenerationIds(row);
  if (generationIds.length === 0) {
    return "skipped";
  }

  try {
    // W11: Fetch cost for ALL generation IDs and sum them
    const result = await fetchAggregateGatewayCost(gateway, generationIds);

    if (result === null) {
      // Empty generationIds array (shouldn't happen, but be defensive)
      return "skipped";
    }

    if (result.status === "incomplete") {
      // Either some IDs returned 404 or no costs available yet
      if (shouldWarnStale(row, now)) {
        captureStaleWarning(deps, row, result.reason, {
          resolvedCount: result.resolvedCount,
          totalCount: result.totalCount,
        });
      }
      return "skipped";
    }

    // A cost resolved by the platform Gateway is a platform-billed call. BYOK
    // calls are not visible to this Gateway client and remain unreconciled.
    // Post the idempotent debit before marking the cost reconciled: if the DB
    // update fails, the next run safely sees the duplicate debit and retries it.
    await deps.meterReconciledTokenUsage({
      aiCallId: row.id,
      userId: row.user_id,
      model: row.model,
      costUsd: result.totalCost,
      completedAt: row.completed_at,
      generationIds,
      metadata: row.metadata,
    });

    const updated = await persistGatewayAiCallCost(deps, {
      rowId: row.id,
      costUsd: result.totalCost,
      // Use first ID for backward compat with the singleton column
      generationId: result.firstId,
      // Pass all IDs so we also populate the array column
      generationIds,
    });
    if (!updated) {
      captureUpdateGuardNoop(deps, row, result.firstId);
      return "skipped";
    }

    return "reconciled";
  } catch (error) {
    if (isNotFoundError(error)) {
      if (shouldWarnStale(row, now)) {
        captureStaleWarning(deps, row, "gateway_generation_not_found");
      }
      return "skipped";
    }

    deps.sentry.captureException(error, {
      extra: {
        ai_call_id: row.id,
        gateway_generation_id: row.gateway_generation_id,
        gateway_generation_ids: row.gateway_generation_ids,
        completed_at: row.completed_at,
      },
    });
    return "errored";
  }
}

export async function runAiCallCostReconciliation(
  overrides: Partial<AiCallCostReconciliationDeps> = {}
): Promise<AiCallCostReconciliationSummary> {
  const deps: AiCallCostReconciliationDeps = {
    ...defaultDeps,
    ...overrides,
  };
  // Build the client lazily so deploys without this optional key still load;
  // missing config should fail the scheduled run visibly at execution time.
  const gateway = deps.gateway ?? createObservabilityGatewayClient();
  const now = deps.now();
  const rows = await loadAiCallCostReconciliationRows(deps);
  const summary: AiCallCostReconciliationSummary = {
    scanned: rows.length,
    reconciled: 0,
    skipped: 0,
    errored: 0,
  };

  let nextRowIndex = 0;
  function takeNextRow(): AiCallCostReconciliationRow | undefined {
    // Keep the shared index increment synchronous and before any awaited work.
    if (nextRowIndex >= rows.length) return undefined;

    const row = rows[nextRowIndex];
    nextRowIndex += 1;
    return row;
  }

  const workers = Array.from(
    { length: Math.min(RECONCILE_CONCURRENCY, rows.length) },
    async () => {
      while (true) {
        const row = takeNextRow();
        if (!row) break;

        const outcome = await reconcileAiCallCostRow(deps, gateway, row, now);
        summary[outcome] += 1;
      }
    }
  );

  await Promise.all(workers);

  return summary;
}

type ScheduledAiCallCostReconciliationDeps = {
  runAiCallCostReconciliation: typeof runAiCallCostReconciliation;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log">;
};

const scheduledDefaultDeps: ScheduledAiCallCostReconciliationDeps = {
  runAiCallCostReconciliation,
  metadata,
  logger,
};

export async function runScheduledAiCallCostReconciliation(
  overrides: Partial<ScheduledAiCallCostReconciliationDeps> = {}
): Promise<AiCallCostReconciliationSummary> {
  const deps: ScheduledAiCallCostReconciliationDeps = {
    ...scheduledDefaultDeps,
    ...overrides,
  };

  const summary = await deps.runAiCallCostReconciliation();
  deps.metadata.set("scanned", summary.scanned);
  deps.metadata.set("reconciled", summary.reconciled);
  deps.metadata.set("skipped", summary.skipped);
  deps.metadata.set("errored", summary.errored);
  deps.logger.log("Reconciled ai_calls Gateway cost", summary);

  return summary;
}

export const reconcileAiCallCostsTask = schedules.task({
  id: TRIGGER_TASK_IDS.aiCallCostReconciliation,
  // Quoted as "every 10 minutes" in observability tooltip copy — update
  // observability-summary.tsx if this changes.
  cron: "*/10 * * * *",
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  run: async () => runScheduledAiCallCostReconciliation(),
});
