import { harnessGatewayTag } from "@/lib/harness/gateway-accounting";
import type {
  AiCallCostReconciliationDeps,
  AiCallCostReconciliationOutcome,
  AiCallCostReconciliationRow,
  GatewayGenerationInfoClient,
} from "./types";
import { captureMissingBillingAccountWarning, shouldWarnStale } from "./sentry";

// Custom Reporting ingests asynchronously. Let a completed run settle before
// its single idempotent debit; the existing ten-minute schedule retries it.
const REPORT_SETTLE_MS = 10 * 60 * 1000;

export async function reconcileHarnessReportCost(
  deps: Pick<
    AiCallCostReconciliationDeps,
    "supabase" | "sentry" | "meterReconciledTokenUsage"
  >,
  gateway: GatewayGenerationInfoClient,
  row: AiCallCostReconciliationRow,
  now: Date
): Promise<AiCallCostReconciliationOutcome> {
  if (
    row.model !== "harness:codex" ||
    row.metadata?.gateway_cost_tracking !== "report-v1" ||
    row.metadata.ai_billing_source !== "platform_ai_gateway"
  )
    return "skipped";
  if (now.getTime() - Date.parse(row.completed_at) < REPORT_SETTLE_MS)
    return "skipped";
  if (!gateway.getSpendReport)
    throw new Error("Gateway spend reporting is unavailable");
  const report = await gateway.getSpendReport({
    startDate: new Date(row.started_at).toISOString().slice(0, 10),
    endDate: new Date(row.completed_at).toISOString().slice(0, 10),
    groupBy: "day",
    tags: [harnessGatewayTag(row.id)],
  });
  if (report.results.length === 0) return "skipped";
  let costUsd = 0;
  let requests = 0;
  for (const result of report.results) {
    if (
      !Number.isFinite(result.totalCost) ||
      result.totalCost < 0 ||
      !Number.isFinite(result.requestCount) ||
      result.requestCount! < 0
    )
      throw new Error("Invalid Gateway harness spend report");
    costUsd += result.totalCost;
    requests += result.requestCount!;
  }
  if (requests === 0) return "skipped";
  costUsd = Math.round(costUsd * 1e8) / 1e8;
  const metering = await deps.meterReconciledTokenUsage({
    aiCallId: row.id,
    userId: row.user_id,
    model: row.model,
    costUsd,
    completedAt: row.completed_at,
    generationIds: [],
    metadata: row.metadata,
  });
  if (metering.reason === "no_billing_account") {
    if (shouldWarnStale(row, now))
      captureMissingBillingAccountWarning(deps, row);
    return "skipped";
  }
  // The report is Gateway-authoritative, but it does not expose generation
  // IDs. Keep those columns unset; guard the initial claim just like the
  // per-generation path, retaining the no-retroactive-billing policy.
  const { data, error } = await deps.supabase
    .from("ai_calls")
    .update({ cost_usd: costUsd, cost_source: "gateway" })
    .eq("id", row.id)
    .isDistinct("cost_source", "gateway")
    .select("id");
  if (error)
    throw new Error(`Failed to persist Gateway harness cost: ${error.message}`);
  return data?.length ? "reconciled" : "skipped";
}
