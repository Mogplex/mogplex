import type {
  AiCallCostReconciliationDeps,
  AiCallCostReconciliationRow,
} from "./types";

const STALE_WARNING_MS = 12 * 60 * 60 * 1000;

export function shouldWarnStale(row: AiCallCostReconciliationRow, now: Date) {
  const completedAt = Date.parse(row.completed_at);
  return (
    Number.isFinite(completedAt) &&
    now.getTime() - completedAt > STALE_WARNING_MS
  );
}

export function captureStaleWarning(
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

export function captureUpdateGuardNoop(
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

export function captureMissingBillingAccountWarning(
  deps: Pick<AiCallCostReconciliationDeps, "sentry">,
  row: AiCallCostReconciliationRow
) {
  deps.sentry.captureMessage(
    "[ai-cost-reconciliation] billing account not found",
    {
      level: "warning",
      fingerprint: ["ai-cost-reconciliation", "no-billing-account", row.id],
      extra: {
        ai_call_id: row.id,
        user_id: row.user_id,
        completed_at: row.completed_at,
      },
    }
  );
}
