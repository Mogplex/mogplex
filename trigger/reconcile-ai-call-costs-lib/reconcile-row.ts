import type {
  AiCallCostReconciliationDeps,
  AiCallCostReconciliationOutcome,
  AiCallCostReconciliationRow,
  GatewayGenerationInfoClient,
} from "./types";
import { fetchAggregateGatewayCost, isNotFoundError } from "./gateway";
import { persistGatewayAiCallCost } from "./persistence";
import {
  captureStaleWarning,
  captureUpdateGuardNoop,
  captureMissingBillingAccountWarning,
  shouldWarnStale,
} from "./sentry";

/**
 * Get the effective list of generation IDs to reconcile for a row.
 * Prefers the array column (W11) but falls back to the singleton (W7).
 *
 * Note: Downstream callers must route through `gatewayCostUpdateFilter` before
 * any PostgREST interpolation. That function validates the ID format via the
 * regex `/^[A-Za-z0-9_-]+$/` to prevent injection.
 */
export function getEffectiveGenerationIds(
  row: AiCallCostReconciliationRow
): string[] {
  if (row.gateway_generation_ids && row.gateway_generation_ids.length > 0) {
    return row.gateway_generation_ids;
  }
  return row.gateway_generation_id ? [row.gateway_generation_id] : [];
}

export async function reconcileAiCallCostRow(
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
    const metering = await deps.meterReconciledTokenUsage({
      aiCallId: row.id,
      userId: row.user_id,
      model: row.model,
      costUsd: result.totalCost,
      completedAt: row.completed_at,
      generationIds,
      metadata: row.metadata,
    });
    if (metering.reason === "no_billing_account") {
      // Keep the row retryable for the 24-hour reconciliation window and do
      // not persist an unbilled final cost. The 12-hour warning leaves an
      // operational response window without weakening billing enforcement.
      if (shouldWarnStale(row, now)) {
        captureMissingBillingAccountWarning(deps, row);
      }
      return "skipped";
    }

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
