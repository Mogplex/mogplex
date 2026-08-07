import { summarizeEntityDispatchEvents } from "@/lib/automation-dispatch";
import { getStartConfig } from "@/lib/flows/graph";
import {
  getJobRunSourceKind,
  isCancelableJobRun,
  isRepairableJobRun,
  isRequeueableJobRun,
  summarizeEntityJobRuns,
} from "@/lib/job-runs";
import type { AiCallEvent, FlowRunDetail, FlowRunRecord } from "@/lib/types";
import { getState } from "./test-store-state";
import { deepClone, nowIso } from "./test-store-types";
import {
  repairFlowPublicationConsistency,
  requireOwnedFlowRow,
  serializeFlow,
} from "./test-store-helpers";

export async function listOwnedFlowsWithSummaries(userId: string) {
  const state = getState();
  const flows = state.flows
    .filter((flow) => flow.user_id === userId)
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime()
    );

  return flows.map((flow) => {
    const consistentFlow = repairFlowPublicationConsistency(flow);
    const runs = state.jobRuns.filter((run) => run.flow_id === flow.id);
    const runIds = new Set(runs.map((run) => run.id));
    const events = state.dispatchEvents.filter(
      (event) =>
        event.flow_id === flow.id ||
        (event.job_run_id ? runIds.has(event.job_run_id) : false)
    );
    return {
      ...serializeFlow(consistentFlow),
      ...summarizeEntityJobRuns(runs),
      ...summarizeEntityDispatchEvents(events),
    };
  });
}

export async function listOwnedFlowRuns(
  userId: string,
  flowId: string,
  limit = 12
) {
  requireOwnedFlowRow(userId, flowId);
  const state = getState();
  const runs = state.jobRuns
    .filter((run) => run.flow_id === flowId)
    .sort(
      (left, right) =>
        new Date(right.created_at || 0).getTime() -
        new Date(left.created_at || 0).getTime()
    )
    .slice(0, limit);

  return runs.map<FlowRunRecord>((run) => {
    const latestDispatchEvent =
      state.dispatchEvents
        .filter((event) => event.job_run_id === run.id)
        .sort(
          (left, right) =>
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime()
        )[0] ?? null;
    const nodeRuns = state.flowNodeRuns.filter(
      (nodeRun) => nodeRun.job_run_id === run.id
    );
    const flowVersionId =
      typeof run.flow_version_id === "string"
        ? run.flow_version_id
        : typeof run.metadata?.flow_version_id === "string"
          ? run.metadata.flow_version_id
          : null;
    const flowVersion = flowVersionId
      ? (state.flowVersions.find(
          (candidate) => candidate.id === flowVersionId
        ) ?? null)
      : null;

    return {
      id: run.id,
      assignment_id: run.assignment_id ?? null,
      trigger_id: run.trigger_id ?? null,
      flow_id: run.flow_id,
      flow_version_id: run.flow_version_id ?? null,
      runtime_provider:
        (run.runtime_provider as "trigger" | "workflow" | null | undefined) ??
        null,
      runtime_run_id: run.runtime_run_id ?? null,
      workflow_run_id: run.workflow_run_id ?? null,
      retry_of_job_run_id: run.retry_of_job_run_id ?? null,
      status:
        (run.status as
          | "pending"
          | "running"
          | "success"
          | "failed"
          | "cancelled") ?? "pending",
      created_at: run.created_at || nowIso(),
      started_at: run.started_at,
      completed_at: run.completed_at ?? null,
      input_tokens: run.input_tokens ?? null,
      output_tokens: run.output_tokens ?? null,
      cost_usd: run.cost_usd ?? null,
      duration_ms: run.duration_ms ?? null,

      error: run.error,
      start_attempts: run.start_attempts ?? 0,
      last_start_attempt_at: run.last_start_attempt_at,
      last_start_error: run.last_start_error ?? null,
      last_start_source: run.last_start_source ?? null,
      cancel_requested_at: run.cancel_requested_at ?? null,
      cancelled_at: run.cancelled_at ?? null,
      cancel_reason: run.cancel_reason ?? null,
      cancel_error: run.cancel_error ?? null,
      metadata: run.metadata ?? null,
      source_kind: getJobRunSourceKind(run),
      source_type:
        typeof run.metadata?.source_type === "string"
          ? run.metadata.source_type
          : flowVersion
            ? (getStartConfig(flowVersion.graph)?.event ?? "flow")
            : "flow",
      repo: {
        id:
          typeof run.metadata?.repo_id === "string"
            ? run.metadata.repo_id
            : null,
        full_name:
          typeof run.metadata?.repo_full_name === "string"
            ? run.metadata.repo_full_name
            : null,
      },
      agent: {
        id: null,
        name: null,
        slug: null,
      },
      latest_ai_call: null,
      repairable: isRepairableJobRun(run),
      requeueable: isRequeueableJobRun(run),
      cancelable: isCancelableJobRun(run),
      active_wait_count: 0,
      latest_dispatch_event: latestDispatchEvent
        ? {
            id: latestDispatchEvent.id,
            event_kind: latestDispatchEvent.event_kind ?? "start",
            outcome: latestDispatchEvent.outcome,
            reason: latestDispatchEvent.reason,
            metadata: deepClone(latestDispatchEvent.metadata || {}),
            created_at: latestDispatchEvent.created_at,
          }
        : null,
      node_runs: deepClone(nodeRuns),
    };
  });
}

export async function loadOwnedFlowRunDetail(
  userId: string,
  flowId: string,
  runId: string
) {
  requireOwnedFlowRow(userId, flowId);
  const state = getState();
  const run =
    state.jobRuns.find(
      (candidate) => candidate.flow_id === flowId && candidate.id === runId
    ) ?? null;

  if (!run) {
    throw new (await import("@/lib/flows/errors")).FlowServiceError(
      "FLOW_RUN_NOT_FOUND",
      "Run not found"
    );
  }

  const dispatchEvents = state.dispatchEvents
    .filter((event) => event.job_run_id === run.id)
    .sort(
      (left, right) =>
        new Date(left.created_at).getTime() -
        new Date(right.created_at).getTime()
    );
  const nodeRuns = state.flowNodeRuns.filter(
    (nodeRun) => nodeRun.job_run_id === run.id
  );
  const aiCalls = state.aiCalls
    .filter((call) => call.job_run_id === run.id && call.user_id === userId)
    .sort(
      (left, right) =>
        new Date(left.started_at).getTime() -
        new Date(right.started_at).getTime()
    );
  const aiCallEventsByCallId = new Map<string, AiCallEvent[]>();
  for (const event of state.aiCallEvents) {
    const bucket = aiCallEventsByCallId.get(event.ai_call_id) || [];
    bucket.push({
      ...deepClone(event),
      payload: deepClone(event.payload || {}),
    });
    aiCallEventsByCallId.set(event.ai_call_id, bucket);
  }
  const latestDispatchEvent = dispatchEvents.at(-1) ?? null;
  const latestAiCall = aiCalls.at(-1) ?? null;
  const flowVersionId =
    typeof run.flow_version_id === "string"
      ? run.flow_version_id
      : typeof run.metadata?.flow_version_id === "string"
        ? run.metadata.flow_version_id
        : null;
  const flowVersion = flowVersionId
    ? (state.flowVersions.find((candidate) => candidate.id === flowVersionId) ??
      null)
    : null;

  return {
    id: run.id,
    assignment_id: run.assignment_id ?? null,
    trigger_id: run.trigger_id ?? null,
    flow_id: run.flow_id,
    flow_version_id: run.flow_version_id ?? null,
    runtime_provider:
      (run.runtime_provider as "trigger" | "workflow" | null | undefined) ??
      null,
    runtime_run_id: run.runtime_run_id ?? null,
    workflow_run_id: run.workflow_run_id ?? null,
    retry_of_job_run_id: run.retry_of_job_run_id ?? null,
    status:
      (run.status as
        | "pending"
        | "running"
        | "success"
        | "failed"
        | "cancelled") ?? "pending",
    created_at: run.created_at || nowIso(),
    started_at: run.started_at,
    completed_at: run.completed_at ?? null,
    input_tokens: run.input_tokens ?? null,
    output_tokens: run.output_tokens ?? null,
    cost_usd: run.cost_usd ?? null,
    duration_ms: run.duration_ms ?? null,
    error: run.error,
    start_attempts: run.start_attempts ?? 0,
    last_start_attempt_at: run.last_start_attempt_at,
    last_start_error: run.last_start_error ?? null,
    last_start_source: run.last_start_source ?? null,
    cancel_requested_at: run.cancel_requested_at ?? null,
    cancelled_at: run.cancelled_at ?? null,
    cancel_reason: run.cancel_reason ?? null,
    cancel_error: run.cancel_error ?? null,
    metadata: run.metadata ?? null,
    source_kind: getJobRunSourceKind(run),
    source_type:
      typeof run.metadata?.source_type === "string"
        ? run.metadata.source_type
        : flowVersion
          ? (getStartConfig(flowVersion.graph)?.event ?? "flow")
          : "flow",
    repo: {
      id:
        typeof run.metadata?.repo_id === "string" ? run.metadata.repo_id : null,
      full_name:
        typeof run.metadata?.repo_full_name === "string"
          ? run.metadata.repo_full_name
          : null,
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
    repairable: isRepairableJobRun(run),
    requeueable: isRequeueableJobRun(run),
    cancelable: isCancelableJobRun(run),
    active_wait_count: 0,
    latest_dispatch_event: latestDispatchEvent
      ? {
          id: latestDispatchEvent.id,
          event_kind: latestDispatchEvent.event_kind ?? "start",
          outcome: latestDispatchEvent.outcome,
          reason: latestDispatchEvent.reason,
          metadata: deepClone(latestDispatchEvent.metadata || {}),
          created_at: latestDispatchEvent.created_at,
        }
      : null,
    node_runs: deepClone(nodeRuns),
    dispatch_events: dispatchEvents.map((event) => ({
      id: event.id,
      event_kind: event.event_kind ?? "start",
      outcome: event.outcome,
      reason: event.reason,
      metadata: event.metadata ?? null,
      created_at: event.created_at,
    })),
    ai_calls: aiCalls.map((call) => ({
      ...call,
      control_state: call.control_state ?? "active",
      tool_calls: deepClone(call.tool_calls || []),
      metadata: deepClone(call.metadata || {}),
      events: aiCallEventsByCallId.get(call.id) || [],
    })),
    review_findings: [],
  } satisfies FlowRunDetail;
}
