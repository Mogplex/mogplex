import { summarizeEntityDispatchEvents } from "@/lib/automation-dispatch";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import {
  loadOwnedFlow as loadOwnedFlowProd,
  serializeFlowRow,
} from "@/lib/flows/server";
import {
  isFlowsE2ETestMode,
  listOwnedFlowsWithSummaries as listOwnedFlowsWithSummariesTest,
} from "@/lib/flows/test-store";
import { summarizeEntityJobRuns } from "@/lib/job-runs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Flow } from "@/lib/types";
import { unwrapOrThrow, unwrapRowsOrThrow } from "@/lib/flows/supabase-result";

/**
 * An "active" flow with no published_version_id is inconsistent. Reloading it
 * through the single-flow path repairs the pointer as a side effect; the result
 * is keyed by id so the caller can substitute the repaired rows.
 */
async function repairInconsistentFlows(
  userId: string,
  flows: readonly {
    id: string;
    status?: string | null;
    published_version_id?: string | null;
  }[]
): Promise<Map<string, Flow>> {
  const repairedFlowMap = new Map<string, Flow>();

  const inconsistentFlowIds = flows
    .filter((flow) => flow.status === "active" && !flow.published_version_id)
    .map((flow) => flow.id);

  if (inconsistentFlowIds.length === 0) return repairedFlowMap;

  const repairedFlows = await Promise.all(
    inconsistentFlowIds.map((flowId) => loadOwnedFlowProd(userId, flowId))
  );

  for (const repaired of repairedFlows) {
    if (repaired) {
      repairedFlowMap.set(repaired.id, repaired);
    }
  }

  return repairedFlowMap;
}

export async function listOwnedFlowsWithSummaries(userId: string) {
  if (isFlowsE2ETestMode()) {
    return listOwnedFlowsWithSummariesTest(userId);
  }

  const flows = unwrapOrThrow(
    await supabaseAdmin
      .from("flows")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
  );

  if (!flows?.length) {
    return [];
  }

  const repairedFlowMap = await repairInconsistentFlows(userId, flows);

  const effectiveFlows = flows.map(
    (flow) => repairedFlowMap.get(flow.id as string) ?? flow
  );

  const publishedVersionIds = effectiveFlows
    .map((flow) => flow.published_version_id)
    .filter(Boolean) as string[];
  const flowIds = effectiveFlows.map((flow) => flow.id);

  // The summaries only need each flow's active runs, its last-24h activity,
  // and its single latest run / latest pressure event. Fetch those directly
  // per concern instead of one global newest-first capped query — a shared
  // cap can be filled entirely by one high-volume flow, leaving every other
  // flow with a null latest status and zeroed counts.
  const runSelect =
    "id, flow_id, status, error, started_at, created_at, last_start_attempt_at";
  const eventSelect =
    "id, job_run_id, trigger_id, flow_id, outcome, reason, created_at";
  const windowStartIso = new Date(
    Date.now() - 24 * 60 * 60 * 1000
  ).toISOString();

  const [
    versionsResult,
    activeRunRows,
    windowRunRows,
    latestRunResults,
    windowEventRows,
    latestReasonEventResults,
  ] = await Promise.all([
    publishedVersionIds.length > 0
      ? supabaseAdmin
          .from("flow_versions")
          .select("*")
          .in("id", publishedVersionIds)
      : Promise.resolve({ data: [], error: null }),
    fetchAllRows(
      () =>
        supabaseAdmin
          .from("job_runs")
          .select(runSelect)
          .in("flow_id", flowIds)
          .in("status", ["pending", "running"]),
      "created_at",
      "active flow job runs"
    ),
    fetchAllRows(
      () =>
        supabaseAdmin
          .from("job_runs")
          .select(runSelect)
          .in("flow_id", flowIds)
          .or(
            `created_at.gte.${windowStartIso},started_at.gte.${windowStartIso}`
          ),
      "created_at",
      "recent flow job runs"
    ),
    Promise.all(
      flowIds.map((flowId) =>
        supabaseAdmin
          .from("job_runs")
          .select(runSelect)
          .eq("flow_id", flowId)
          .order("created_at", { ascending: false })
          .limit(1)
      )
    ),
    fetchAllRows(
      () =>
        supabaseAdmin
          .from("automation_dispatch_events")
          .select(eventSelect)
          .in("flow_id", flowIds)
          .gte("created_at", windowStartIso),
      "created_at",
      "recent flow dispatch events"
    ),
    Promise.all(
      flowIds.map((flowId) =>
        supabaseAdmin
          .from("automation_dispatch_events")
          .select(eventSelect)
          .eq("flow_id", flowId)
          .not("reason", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
      )
    ),
  ]);

  const versionsById = new Map(
    unwrapRowsOrThrow(versionsResult).map((version) => [version.id, version])
  );

  type FlowJobRunRow = {
    id: string;
    flow_id: string | null;
    status: string | null;
    error: string | null;
    started_at: string | null;
    created_at: string | null;
    last_start_attempt_at: string | null;
  };
  const jobRunById = new Map<string, FlowJobRunRow>();
  for (const row of [
    ...activeRunRows,
    ...windowRunRows,
    ...latestRunResults.flatMap((result) => unwrapRowsOrThrow(result)),
  ] as FlowJobRunRow[]) {
    jobRunById.set(row.id, row);
  }
  const jobRuns = Array.from(jobRunById.values());
  const allEvents = new Map<
    string,
    {
      id: string;
      job_run_id: string | null;
      trigger_id: string | null;
      flow_id: string | null;
      outcome:
        | "queued"
        | "suppressed"
        | "started"
        | "deferred"
        | "start_failed"
        | "completed"
        | "failed"
        | "cancel_requested"
        | "cancelled"
        | "cancel_failed"
        | "reconciled";
      reason: string | null;
      created_at: string;
    }
  >();

  for (const event of [
    ...windowEventRows,
    ...latestReasonEventResults.flatMap((result) => unwrapRowsOrThrow(result)),
  ] as Parameters<typeof allEvents.set>[1][]) {
    allEvents.set(event.id, event);
  }

  return effectiveFlows.map((flow) => {
    const runs = jobRuns.filter((run) => run.flow_id === flow.id);
    const runIds = new Set(runs.map((run) => run.id));
    const events = Array.from(allEvents.values()).filter(
      (event) =>
        event.flow_id === flow.id ||
        (event.job_run_id ? runIds.has(event.job_run_id) : false)
    );
    return {
      ...("published_version" in flow
        ? flow
        : serializeFlowRow(
            flow,
            flow.published_version_id
              ? (versionsById.get(flow.published_version_id) ?? null)
              : null
          )),
      ...summarizeEntityJobRuns(runs),
      ...summarizeEntityDispatchEvents(events),
    };
  });
}
