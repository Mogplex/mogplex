import * as Sentry from "@sentry/nextjs";
import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import { createObservabilityGatewayClient } from "@/lib/observability/gateway-client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

// Compare the same run-cost scope on both sides; Gateway is authoritative.
const DIVERGENCE_THRESHOLD = 0.05;
const DAY_MS = 24 * 60 * 60 * 1000;
// These internal checks never create customer ai_calls. All other spend,
// including unknown or untagged requests, stays in the drift comparison.
const INTERNAL_GATEWAY_TAGS = ["surface:quality", "surface:decisions"];

export type AiSpendDivergenceSummary = {
  startDate: string;
  endDate: string;
  gatewayTotal: number;
  internalOverheadTotal: number;
  trackedGatewayTotal: number;
  localTotal: number;
  divergenceRatio: number | null;
  divergent: boolean;
  skipped: boolean;
};

type GatewaySpendReport = {
  results: Array<{
    day?: string;
    totalCost: number;
  }>;
};

type GatewaySpendReportClient = {
  getSpendReport: (params: {
    startDate: string;
    endDate: string;
    groupBy: "day";
    tags?: string[];
  }) => Promise<GatewaySpendReport>;
};

type SentryClient = {
  captureMessage: (
    message: string,
    captureContext?: Parameters<typeof Sentry.captureMessage>[1]
  ) => unknown;
};

type AiSpendDivergenceDeps = {
  gateway?: GatewaySpendReportClient;
  supabase: typeof supabaseAdmin;
  sentry: SentryClient;
  now: () => Date;
};

const defaultDeps: AiSpendDivergenceDeps = {
  supabase: supabaseAdmin,
  sentry: Sentry,
  now: () => new Date(),
};

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getYesterdayUtcWindow(now: Date) {
  const todayStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const start = new Date(todayStartMs - DAY_MS);
  const end = new Date(todayStartMs);

  return {
    start,
    end,
    startDate: formatUtcDate(start),
    dbExclusiveEndDate: formatUtcDate(end),
    // AI Gateway's grouped spend report expects an inclusive date for this single-day window.
    gatewayInclusiveEndDate: formatUtcDate(start),
  };
}

function readNumeric(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new Error("Invalid numeric ai_calls cost total");
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
    throw new Error("Invalid numeric ai_calls cost total");
  }
  if (typeof value === "string") return 0;
  throw new Error("Invalid numeric ai_calls cost total");
}

function summarizeSpendReportRows(
  rows: Array<{ day?: string; totalCost: number }>
) {
  return rows.map(({ day, totalCost }) => ({ day, totalCost }));
}

function captureSpendDrift(
  deps: Pick<AiSpendDivergenceDeps, "sentry">,
  input: {
    startDate: string;
    endDate: string;
    gatewayTotal: number;
    internalOverheadTotal: number;
    trackedGatewayTotal: number;
    localTotal: number;
    divergenceRatio: number | null;
    spendReport: GatewaySpendReport;
    reason?: string;
  }
) {
  deps.sentry.captureMessage("[ai-spend-divergence] Gateway spend drift", {
    level: "warning",
    extra: {
      start_date: input.startDate,
      end_date: input.endDate,
      gateway_total: input.gatewayTotal,
      internal_overhead_total: input.internalOverheadTotal,
      tracked_gateway_total: input.trackedGatewayTotal,
      local_total: input.localTotal,
      divergence_ratio: input.divergenceRatio,
      reason: input.reason,
      per_day: summarizeSpendReportRows(input.spendReport.results),
    },
  });
}

export async function loadLocalAiCallCostTotal(
  deps: Pick<AiSpendDivergenceDeps, "supabase">,
  window: { start: Date; end: Date }
): Promise<number> {
  // PostgREST aggregate functions are disabled on this project, so a
  // `cost_usd.sum()` select returns 400 PGRST123. Sum via the
  // sum_ai_call_costs RPC, which also sidesteps the 1000-row cap that would
  // make a client-side sum undercount on busy days.
  const { data, error } = await deps.supabase.rpc("sum_ai_call_costs", {
    p_start: window.start.toISOString(),
    p_end: window.end.toISOString(),
  });

  if (error) {
    throw new Error(`Failed to sum ai_calls cost_usd: ${error.message}`);
  }

  return readNumeric(data as number | string | null);
}

export async function runAiSpendDivergenceCheck(
  overrides: Partial<AiSpendDivergenceDeps> = {}
): Promise<AiSpendDivergenceSummary> {
  const deps: AiSpendDivergenceDeps = {
    ...defaultDeps,
    ...overrides,
  };
  // Build the client lazily so deploys without this optional key still load;
  // missing config should fail the scheduled run visibly at execution time.
  const gateway = deps.gateway ?? createObservabilityGatewayClient();
  const window = getYesterdayUtcWindow(deps.now());
  const [spendReport, internalReport, localTotal] = await Promise.all([
    // Gateway failures should fail the scheduled run; divergence over threshold
    // is the warning-only tripwire path.
    gateway.getSpendReport({
      startDate: window.startDate,
      endDate: window.gatewayInclusiveEndDate,
      groupBy: "day",
    }),
    // Gateway applies tags with ANY semantics before grouping. Grouping by
    // day counts each matching request once, even if it carries both tags.
    gateway.getSpendReport({
      startDate: window.startDate,
      endDate: window.gatewayInclusiveEndDate,
      groupBy: "day",
      tags: INTERNAL_GATEWAY_TAGS,
    }),
    loadLocalAiCallCostTotal(deps, window),
  ]);

  const sumReport = (report: GatewaySpendReport) =>
    report.results.reduce((total, row) => {
      if (!Number.isFinite(row.totalCost) || row.totalCost < 0)
        throw new Error("Invalid Gateway spend report cost");
      return total + row.totalCost;
    }, 0);
  const gatewayTotal = sumReport(spendReport);
  const internalOverheadTotal = sumReport(internalReport);
  if (internalOverheadTotal - gatewayTotal > 1e-8)
    throw new Error("Internal Gateway spend exceeds the total report");
  const trackedGatewayTotal = Math.max(
    0,
    Math.round((gatewayTotal - internalOverheadTotal) * 1e8) / 1e8
  );
  const totals = {
    gatewayTotal,
    internalOverheadTotal,
    trackedGatewayTotal,
    localTotal,
  };

  if (localTotal < 0) {
    captureSpendDrift(deps, {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      ...totals,
      divergenceRatio: null,
      spendReport,
      reason: "local_negative",
    });

    return {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      ...totals,
      divergenceRatio: null,
      divergent: true,
      skipped: false,
    };
  }

  // Zero-local days are intentionally skipped per W7's verification matrix.
  if (localTotal === 0) {
    if (trackedGatewayTotal > 0) {
      captureSpendDrift(deps, {
        startDate: window.startDate,
        endDate: window.dbExclusiveEndDate,
        ...totals,
        divergenceRatio: null,
        spendReport,
        reason: "zero_local_nonzero_gateway",
      });
    }

    return {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      ...totals,
      divergenceRatio: null,
      divergent: false,
      skipped: true,
    };
  }

  if (trackedGatewayTotal <= 0) {
    captureSpendDrift(deps, {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      ...totals,
      divergenceRatio: null,
      spendReport,
      reason: "gateway_zero_local_nonzero",
    });

    return {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      ...totals,
      divergenceRatio: null,
      divergent: true,
      skipped: false,
    };
  }

  // Gateway spend is the authoritative denominator for this W7 backstop.
  const divergenceRatio =
    Math.abs(trackedGatewayTotal - localTotal) / trackedGatewayTotal;
  const divergent = divergenceRatio > DIVERGENCE_THRESHOLD;

  if (divergent) {
    captureSpendDrift(deps, {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      ...totals,
      divergenceRatio,
      spendReport,
    });
  }

  return {
    startDate: window.startDate,
    endDate: window.dbExclusiveEndDate,
    ...totals,
    divergenceRatio,
    divergent,
    skipped: false,
  };
}

type ScheduledAiSpendDivergenceDeps = {
  runAiSpendDivergenceCheck: typeof runAiSpendDivergenceCheck;
  metadata: Pick<typeof metadata, "set">;
  logger: Pick<typeof logger, "log">;
};

const scheduledDefaultDeps: ScheduledAiSpendDivergenceDeps = {
  runAiSpendDivergenceCheck,
  metadata,
  logger,
};

export async function runScheduledAiSpendDivergenceCheck(
  overrides: Partial<ScheduledAiSpendDivergenceDeps> = {}
): Promise<AiSpendDivergenceSummary> {
  const deps: ScheduledAiSpendDivergenceDeps = {
    ...scheduledDefaultDeps,
    ...overrides,
  };

  const summary = await deps.runAiSpendDivergenceCheck();
  deps.metadata.set("gatewayTotal", summary.gatewayTotal);
  deps.metadata.set("internalOverheadTotal", summary.internalOverheadTotal);
  deps.metadata.set("trackedGatewayTotal", summary.trackedGatewayTotal);
  deps.metadata.set("localTotal", summary.localTotal);
  deps.metadata.set("divergent", summary.divergent);
  deps.metadata.set("skipped", summary.skipped);
  deps.logger.log("Checked AI Gateway spend divergence", summary);

  return summary;
}

export const aiSpendDivergenceCheckTask = schedules.task({
  id: TRIGGER_TASK_IDS.aiSpendDivergenceCheck,
  cron: "0 5 * * *",
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  run: async () => runScheduledAiSpendDivergenceCheck(),
});
