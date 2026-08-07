import { FlowServiceError } from "@/lib/flows/errors";
import { coerceGraph, getStartConfig } from "@/lib/flows/graph";
import { loadOwnedFlow as loadOwnedFlowProd } from "@/lib/flows/server";
import {
  isFlowsE2ETestMode,
  loadOwnedFlowRunDetail as loadOwnedFlowRunDetailTest,
  listOwnedFlowRuns as listOwnedFlowRunsTest,
} from "@/lib/flows/test-store";
import {
  getJobRunSourceKind,
  isCancelableJobRun,
  isRepairableJobRun,
  isRequeueableJobRun,
} from "@/lib/job-runs";
import { listJobRunReviewFindings } from "@/lib/review-findings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  FlowNodeRun,
  FlowRunDetail,
  FlowRunRecord,
  FlowWait,
} from "@/lib/types";
import { unwrapRowsOrThrow } from "@/lib/flows/supabase-result";
import {
  collectFlowRunLookupIds,
  readFlowVersionSourceType,
  indexLatestDispatchEvents,
  toFlowRunRecord,
} from "@/lib/flows/api-run-utils";

async function listOwnedFlowRunsProd(
  userId: string,
  flowId: string,
  limit = 12
) {
  const flow = await loadOwnedFlowProd(userId, flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  const runs = unwrapRowsOrThrow(
    await supabaseAdmin
      .from("job_runs")
      .select(
        "id, assignment_id, trigger_id, flow_id, flow_version_id, runtime_provider, runtime_run_id, workflow_run_id, retry_of_job_run_id, status, created_at, started_at, completed_at, input_tokens, output_tokens, duration_ms, error, start_attempts, last_start_attempt_at, last_start_error, last_start_source, cancel_requested_at, cancelled_at, cancel_reason, cancel_error, metadata"
      )
      .eq("flow_id", flowId)
      .order("created_at", { ascending: false })
      .limit(limit)
  );

  if (runs.length === 0) {
    return [] as FlowRunRecord[];
  }

  const { jobRunIds, flowVersionIds, repoIds } = collectFlowRunLookupIds(runs);

  const [
    reposResult,
    dispatchResult,
    nodeRunsResult,
    flowVersionsResult,
    activeWaitsResult,
  ] = await Promise.all([
    repoIds.length > 0
      ? supabaseAdmin.from("repos").select("id, full_name").in("id", repoIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from("automation_dispatch_events")
      .select(
        "id, job_run_id, event_kind, outcome, reason, metadata, created_at"
      )
      .in("job_run_id", jobRunIds)
      .order("created_at", { ascending: false })
      .limit(10000),
    supabaseAdmin
      .from("flow_node_runs")
      .select("*")
      .in("job_run_id", jobRunIds)
      .order("created_at", { ascending: true })
      .limit(10000),
    flowVersionIds.length > 0
      ? supabaseAdmin
          .from("flow_versions")
          .select("id, graph")
          .in("id", flowVersionIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from("flow_waits")
      .select("job_run_id")
      .eq("user_id", userId)
      .in("job_run_id", jobRunIds)
      .eq("status", "waiting"),
  ]);

  const reposById = new Map(
    unwrapRowsOrThrow(reposResult).map((repo) => [repo.id, repo])
  );
  const flowSourceTypeByVersionId = new Map(
    unwrapRowsOrThrow(flowVersionsResult).map((version) => [
      version.id,
      readFlowVersionSourceType(version.graph),
    ])
  );
  const latestDispatchByJobId = indexLatestDispatchEvents(
    unwrapRowsOrThrow(dispatchResult)
  );

  const nodeRunsByJobId = new Map<string, FlowNodeRun[]>();
  for (const nodeRun of unwrapRowsOrThrow(nodeRunsResult) as FlowNodeRun[]) {
    const bucket = nodeRunsByJobId.get(nodeRun.job_run_id) || [];
    bucket.push(nodeRun);
    nodeRunsByJobId.set(nodeRun.job_run_id, bucket);
  }
  const activeWaitCountByJobId = new Map<string, number>();
  for (const wait of unwrapRowsOrThrow(activeWaitsResult)) {
    activeWaitCountByJobId.set(
      wait.job_run_id,
      (activeWaitCountByJobId.get(wait.job_run_id) ?? 0) + 1
    );
  }

  return runs.map<FlowRunRecord>((run) =>
    toFlowRunRecord(run, {
      reposById,
      flowSourceTypeByVersionId,
      latestDispatchByJobId,
      nodeRunsByJobId,
      activeWaitCountByJobId,
    })
  );
}

export async function listOwnedFlowRuns(
  userId: string,
  flowId: string,
  limit = 12
) {
  if (isFlowsE2ETestMode()) {
    return listOwnedFlowRunsTest(userId, flowId, limit);
  }

  return listOwnedFlowRunsProd(userId, flowId, limit);
}

async function loadOwnedFlowRunDetailProd(
  userId: string,
  flowId: string,
  runId: string
) {
  const flow = await loadOwnedFlowProd(userId, flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  const { data: run, error: runError } = await supabaseAdmin
    .from("job_runs")
    .select(
      "id, assignment_id, trigger_id, flow_id, flow_version_id, runtime_provider, runtime_run_id, workflow_run_id, retry_of_job_run_id, status, created_at, started_at, completed_at, input_tokens, output_tokens, duration_ms, error, start_attempts, last_start_attempt_at, last_start_error, last_start_source, cancel_requested_at, cancelled_at, cancel_reason, cancel_error, metadata"
    )
    .eq("flow_id", flowId)
    .eq("id", runId)
    .maybeSingle();

  if (runError) {
    throw new Error(runError.message);
  }

  if (!run) {
    throw new FlowServiceError("FLOW_RUN_NOT_FOUND", "Run not found");
  }

  const repoId =
    typeof run.metadata?.repo_id === "string" ? run.metadata.repo_id : null;
  const flowVersionId =
    typeof run.flow_version_id === "string"
      ? run.flow_version_id
      : typeof run.metadata?.flow_version_id === "string"
        ? run.metadata.flow_version_id
        : null;

  const [
    repoResult,
    dispatchResult,
    nodeRunsResult,
    aiCallsResult,
    flowVersionResult,
    waitsResult,
    reviewFindings,
  ] = await Promise.all([
    repoId
      ? supabaseAdmin
          .from("repos")
          .select("id, full_name")
          .eq("id", repoId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseAdmin
      .from("automation_dispatch_events")
      .select("id, event_kind, outcome, reason, metadata, created_at")
      .eq("job_run_id", runId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("flow_node_runs")
      .select("*")
      .eq("job_run_id", runId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("ai_calls")
      .select("*")
      .eq("user_id", userId)
      .eq("job_run_id", runId)
      .order("started_at", { ascending: true }),
    flowVersionId
      ? supabaseAdmin
          .from("flow_versions")
          .select("id, graph")
          .eq("id", flowVersionId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseAdmin
      .from("flow_waits")
      .select("*")
      .eq("user_id", userId)
      .eq("job_run_id", runId)
      .order("created_at", { ascending: true }),
    listJobRunReviewFindings(runId),
  ]);

  if (repoResult.error) {
    throw new Error(repoResult.error.message);
  }
  if (dispatchResult.error) {
    throw new Error(dispatchResult.error.message);
  }
  if (nodeRunsResult.error) {
    throw new Error(nodeRunsResult.error.message);
  }
  if (aiCallsResult.error) {
    throw new Error(aiCallsResult.error.message);
  }
  if (flowVersionResult.error) {
    throw new Error(flowVersionResult.error.message);
  }
  if (waitsResult.error) {
    throw new Error(waitsResult.error.message);
  }

  const aiCalls = aiCallsResult.data || [];
  const aiCallIds = aiCalls.map((call) => call.id);
  const { data: aiCallEvents, error: aiCallEventsError } =
    aiCallIds.length > 0
      ? await supabaseAdmin
          .from("ai_call_events")
          .select("*")
          .in("ai_call_id", aiCallIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };

  if (aiCallEventsError) {
    throw new Error(aiCallEventsError.message);
  }

  const aiCallEventsByCallId = new Map<string, typeof aiCallEvents>();
  for (const event of aiCallEvents || []) {
    const bucket = aiCallEventsByCallId.get(event.ai_call_id) || [];
    bucket.push(event);
    aiCallEventsByCallId.set(event.ai_call_id, bucket);
  }

  const dispatchEvents = dispatchResult.data || [];
  const latestDispatchEventRow = dispatchEvents.at(-1) ?? null;
  const latestDispatchEvent = latestDispatchEventRow
    ? {
        id: latestDispatchEventRow.id,
        event_kind: latestDispatchEventRow.event_kind,
        outcome: latestDispatchEventRow.outcome,
        reason: latestDispatchEventRow.reason,
        metadata: latestDispatchEventRow.metadata ?? null,
        created_at: latestDispatchEventRow.created_at,
      }
    : null;
  const latestAiCall = aiCalls.length > 0 ? aiCalls.at(-1) : null;
  const flowSourceType = flowVersionResult.data
    ? (getStartConfig(coerceGraph(flowVersionResult.data.graph))?.event ?? null)
    : null;

  return {
    ...run,
    source_kind: getJobRunSourceKind(run),
    source_type:
      typeof run.metadata?.source_type === "string"
        ? run.metadata.source_type
        : (flowSourceType ?? "flow"),
    repo: {
      id: repoResult.data?.id || repoId,
      full_name:
        repoResult.data?.full_name ||
        (typeof run.metadata?.repo_full_name === "string"
          ? run.metadata.repo_full_name
          : null),
    },
    agent: {
      id: null,
      name: null,
      slug: null,
    },
    latest_ai_call: latestAiCall
      ? {
          id: latestAiCall.id,
          status: latestAiCall.status,
          model: latestAiCall.model,
          total_tokens: latestAiCall.total_tokens,
          tool_calls_count: latestAiCall.tool_calls_count,
          started_at: latestAiCall.started_at,
        }
      : null,
    cost_usd: (run as { cost_usd?: number | null }).cost_usd ?? null,
    repairable: isRepairableJobRun(run),
    requeueable: isRequeueableJobRun(run),
    cancelable: isCancelableJobRun(run),
    active_wait_count: (waitsResult.data || []).filter(
      (wait) => wait.status === "waiting"
    ).length,
    latest_dispatch_event: latestDispatchEvent,
    node_runs: (nodeRunsResult.data || []) as FlowNodeRun[],
    dispatch_events: dispatchEvents.map((event) => ({
      id: event.id,
      event_kind: event.event_kind,
      outcome: event.outcome,
      reason: event.reason,
      metadata: event.metadata ?? null,
      created_at: event.created_at,
    })),
    ai_calls: aiCalls.map((call) => ({
      ...call,
      events: aiCallEventsByCallId.get(call.id) || [],
    })),
    review_findings: reviewFindings,
    waits: (waitsResult.data || []) as FlowWait[],
  } satisfies FlowRunDetail;
}

export async function loadOwnedFlowRunDetail(
  userId: string,
  flowId: string,
  runId: string
) {
  if (isFlowsE2ETestMode()) {
    return loadOwnedFlowRunDetailTest(userId, flowId, runId);
  }

  return loadOwnedFlowRunDetailProd(userId, flowId, runId);
}
