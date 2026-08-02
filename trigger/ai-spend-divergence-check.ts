import * as Sentry from "@sentry/nextjs";
import { logger, metadata, schedules } from "@trigger.dev/sdk/v3";
import { createObservabilityGatewayClient } from "@/lib/observability/gateway-client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

// Gateway is the authoritative denominator: |gateway - local| / gateway.
const DIVERGENCE_THRESHOLD = 0.05;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AiSpendDivergenceSummary = {
  startDate: string;
  endDate: string;
  gatewayTotal: number;
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
  const [spendReport, localTotal] = await Promise.all([
    // Gateway failures should fail the scheduled run; divergence over threshold
    // is the warning-only tripwire path.
    gateway.getSpendReport({
      startDate: window.startDate,
      endDate: window.gatewayInclusiveEndDate,
      groupBy: "day",
    }),
    loadLocalAiCallCostTotal(deps, window),
  ]);

  const gatewayTotal = spendReport.results.reduce(
    (total, row) => total + row.totalCost,
    0
  );

  if (localTotal < 0) {
    captureSpendDrift(deps, {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      gatewayTotal,
      localTotal,
      divergenceRatio: null,
      spendReport,
      reason: "local_negative",
    });

    return {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      gatewayTotal,
      localTotal,
      divergenceRatio: null,
      divergent: true,
      skipped: false,
    };
  }

  // Zero-local days are intentionally skipped per W7's verification matrix.
  if (localTotal === 0) {
    if (gatewayTotal > 0) {
      captureSpendDrift(deps, {
        startDate: window.startDate,
        endDate: window.dbExclusiveEndDate,
        gatewayTotal,
        localTotal,
        divergenceRatio: null,
        spendReport,
        reason: "zero_local_nonzero_gateway",
      });
    }

    return {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      gatewayTotal,
      localTotal,
      divergenceRatio: null,
      divergent: false,
      skipped: true,
    };
  }

  if (gatewayTotal <= 0) {
    captureSpendDrift(deps, {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      gatewayTotal,
      localTotal,
      divergenceRatio: null,
      spendReport,
      reason: "gateway_zero_local_nonzero",
    });

    return {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      gatewayTotal,
      localTotal,
      divergenceRatio: null,
      divergent: true,
      skipped: false,
    };
  }

  // Gateway spend is the authoritative denominator for this W7 backstop.
  const divergenceRatio = Math.abs(gatewayTotal - localTotal) / gatewayTotal;
  const divergent = divergenceRatio > DIVERGENCE_THRESHOLD;

  if (divergent) {
    captureSpendDrift(deps, {
      startDate: window.startDate,
      endDate: window.dbExclusiveEndDate,
      gatewayTotal,
      localTotal,
      divergenceRatio,
      spendReport,
    });
  }

  return {
    startDate: window.startDate,
    endDate: window.dbExclusiveEndDate,
    gatewayTotal,
    localTotal,
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
