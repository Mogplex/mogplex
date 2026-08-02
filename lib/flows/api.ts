import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
} from "ai";
import { summarizeEntityDispatchEvents } from "@/lib/automation-dispatch";
import { FlowServiceError } from "@/lib/flows/errors";
import { createFlowAssistantTools } from "@/lib/flows/assistant-tools";
import { listUsableModelIdsForScope } from "@/lib/models/default-model";
import {
  FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE,
  FLOW_ASSISTANT_RESULT_DATA_TYPE,
  type FlowAssistantResultData,
} from "@/lib/flows/assistant-chat-payload";
import {
  coerceGraph,
  getStartConfig,
  validateFlowGraph,
} from "@/lib/flows/graph";
import {
  assertOwnedFlowGraphAgents,
  buildDefaultFlowDraft as buildDefaultFlowDraftProd,
  createFlowTemplate as createFlowTemplateProd,
  createPersonalFlowTemplate as createPersonalFlowTemplateProd,
  deleteFlowTemplate as deleteFlowTemplateProd,
  deleteFlow as deleteFlowProd,
  duplicateFlow as duplicateFlowProd,
  listFlowTemplates as listFlowTemplatesProd,
  listOwnedPersonalFlowTemplates as listOwnedPersonalFlowTemplatesProd,
  loadFlowTemplate as loadFlowTemplateProd,
  loadOwnedFlow as loadOwnedFlowProd,
  loadOwnedPersonalFlowTemplate as loadOwnedPersonalFlowTemplateProd,
  publishFlowDraft as publishFlowDraftProd,
  // resolveFlowGraphPresetAgents is intentionally imported directly from
  // server.ts and is NOT wrapped in an isFlowsE2ETestMode() branch. Preset
  // resolution must always hit real Supabase so that agent rows are created
  // (or looked up) under the real user ID. The E2E test store handles
  // updateFlow / publishFlowDraft separately and never surfaces preset: IDs.
  resolveFlowGraphPresetAgents,
  serializeFlowRow,
  syncFlowActivation as syncFlowActivationProd,
} from "@/lib/flows/server";
import {
  createFlowForUser as createFlowForUserTest,
  createFlowTemplate as createFlowTemplateTest,
  createPersonalFlowTemplate as createPersonalFlowTemplateTest,
  deleteFlowTemplate as deleteFlowTemplateTest,
  deleteFlow as deleteFlowTest,
  duplicateFlow as duplicateFlowTest,
  generateFlowAssistantSuggestion as generateFlowAssistantSuggestionTest,
  isFlowsE2ETestMode,
  listFlowTemplates as listFlowTemplatesTest,
  loadOwnedFlowRunDetail as loadOwnedFlowRunDetailTest,
  listOwnedFlowRuns as listOwnedFlowRunsTest,
  listOwnedFlowsWithSummaries as listOwnedFlowsWithSummariesTest,
  listOwnedPersonalFlowTemplates as listOwnedPersonalFlowTemplatesTest,
  loadOwnedFlow as loadOwnedFlowTest,
  loadOwnedInstallation as loadOwnedInstallationTest,
  publishFlowDraft as publishFlowDraftTest,
  syncFlowActivation as syncFlowActivationTest,
  updateFlow as updateFlowTest,
} from "@/lib/flows/test-store";
import {
  summarizeEntityJobRuns,
  getJobRunSourceKind,
  isCancelableJobRun,
  isRepairableJobRun,
  isRequeueableJobRun,
} from "@/lib/job-runs";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import { recordAiCallTelemetry } from "@/lib/observability/ai-call-telemetry";
import {
  captureUsage,
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
  mergeUsage,
  type CapturedUsage,
} from "@/lib/observability/usage";
import { listJobRunReviewFindings } from "@/lib/review-findings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  Flow,
  FlowGraph,
  FlowNodeRun,
  FlowRunDetail,
  FlowRunRecord,
  FlowWait,
  JobRun,
} from "@/lib/types";
import type { FlowStarterTemplateId } from "@/lib/flows/templates";
import type { ProductResourceScope } from "@/lib/team-resource-scope";
import {
  bindFlowGraphToScope,
  flowTemplateRequiresRepository,
  preparePersonalFlowTemplateGraphForValidation,
} from "@/lib/flows/templates";
import { unwrapOrThrow, unwrapRowsOrThrow } from "@/lib/flows/supabase-result";
import type { Capability } from "@/lib/team-capabilities";
import type { LanguageModelUsage, ProviderMetadata, UIMessage } from "ai";

async function loadOwnedInstallationProd(
  userId: string,
  installationId: number
) {
  const { data } = await supabaseAdmin
    .from("github_installations")
    .select("id")
    .eq("user_id", userId)
    .eq("installation_id", installationId)
    .maybeSingle();

  return data;
}

export async function loadOwnedInstallation(
  userId: string,
  installationId: number
) {
  if (isFlowsE2ETestMode()) {
    return loadOwnedInstallationTest(userId, installationId);
  }

  return loadOwnedInstallationProd(userId, installationId);
}

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
  const [versionsResult, jobRunsResult, flowDispatchResult] = await Promise.all(
    [
      publishedVersionIds.length > 0
        ? supabaseAdmin
            .from("flow_versions")
            .select("*")
            .in("id", publishedVersionIds)
        : Promise.resolve({ data: [], error: null }),
      supabaseAdmin
        .from("job_runs")
        .select(
          "id, flow_id, status, error, started_at, created_at, last_start_attempt_at"
        )
        .in("flow_id", flowIds)
        .order("created_at", { ascending: false })
        .limit(10000),
      flowIds.length > 0
        ? supabaseAdmin
            .from("automation_dispatch_events")
            .select(
              "id, job_run_id, trigger_id, flow_id, outcome, reason, created_at"
            )
            .in("flow_id", flowIds)
            .order("created_at", { ascending: false })
            .limit(10000)
        : Promise.resolve({ data: [], error: null }),
    ]
  );

  const versionsById = new Map(
    unwrapRowsOrThrow(versionsResult).map((version) => [version.id, version])
  );
  const jobRuns = unwrapRowsOrThrow(jobRunsResult);
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

  for (const event of unwrapRowsOrThrow(flowDispatchResult)) {
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

/**
 * Gather the de-duplicated ids the run list needs to join against. A run's
 * flow version can come from the column or from metadata, so both are
 * considered.
 */
function collectFlowRunLookupIds(
  runs: readonly { id: string; flow_version_id: unknown; metadata: unknown }[]
) {
  const flowVersionIds = new Set<string>();
  const repoIds = new Set<string>();

  for (const run of runs) {
    const columnVersionId =
      typeof run.flow_version_id === "string" ? run.flow_version_id : null;
    const metadataVersionId = metadataString(run.metadata, "flow_version_id");
    if (columnVersionId) flowVersionIds.add(columnVersionId);
    if (metadataVersionId) flowVersionIds.add(metadataVersionId);

    const repoId = metadataString(run.metadata, "repo_id");
    if (repoId) repoIds.add(repoId);
  }

  return {
    jobRunIds: runs.map((run) => run.id),
    flowVersionIds: Array.from(flowVersionIds),
    repoIds: Array.from(repoIds),
  };
}

function readFlowVersionSourceType(graph: unknown): string | null {
  return getStartConfig(coerceGraph(graph))?.event ?? null;
}

type LatestDispatchEvent = {
  id: string;
  event_kind: "enqueue" | "start" | "control";
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
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Newest dispatch event per job run. Rows arrive newest-first, so the first one
 * seen for a job run wins and later ones are ignored.
 */
function indexLatestDispatchEvents(
  events: readonly (LatestDispatchEvent & { job_run_id: string | null })[]
): Map<string, LatestDispatchEvent> {
  const latestDispatchByJobId = new Map<string, LatestDispatchEvent>();

  for (const event of events) {
    if (!event.job_run_id || latestDispatchByJobId.has(event.job_run_id)) {
      continue;
    }
    latestDispatchByJobId.set(event.job_run_id, {
      id: event.id,
      event_kind: event.event_kind,
      outcome: event.outcome,
      reason: event.reason,
      metadata: event.metadata ?? null,
      created_at: event.created_at,
    });
  }

  return latestDispatchByJobId;
}

/** Read a string field out of a job run's free-form metadata blob. */
function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = Reflect.get(metadata, key);
  return typeof value === "string" ? value : null;
}

type FlowRunIndexes = {
  reposById: Map<string, { id: string; full_name: string | null }>;
  flowSourceTypeByVersionId: Map<string, string | null>;
  latestDispatchByJobId: Map<
    string,
    NonNullable<FlowRunRecord["latest_dispatch_event"]>
  >;
  nodeRunsByJobId: Map<string, FlowNodeRun[]>;
  activeWaitCountByJobId: Map<string, number>;
};

/** The joined repo row wins; metadata is the fallback for runs that outlive it. */
function resolveFlowRunRepo(
  metadata: unknown,
  reposById: FlowRunIndexes["reposById"]
) {
  const repoId = metadataString(metadata, "repo_id");
  const repo = repoId ? reposById.get(repoId) : null;

  return {
    id: repo?.id || repoId,
    full_name: repo?.full_name || metadataString(metadata, "repo_full_name"),
  };
}

function resolveFlowRunSourceType(
  metadata: unknown,
  flowVersionId: string | null,
  flowSourceTypeByVersionId: FlowRunIndexes["flowSourceTypeByVersionId"]
): string {
  const explicit = metadataString(metadata, "source_type");
  if (explicit !== null) return explicit;
  if (!flowVersionId) return "flow";
  return flowSourceTypeByVersionId.get(flowVersionId) ?? "flow";
}

// `cost_usd` is optional here because some callers select a narrower column
// set; the returned record always fills it in explicitly.
function toFlowRunRecord<
  TRun extends Omit<JobRun, "cost_usd"> & { cost_usd?: number | null },
>(run: TRun, indexes: FlowRunIndexes): FlowRunRecord {
  const flowVersionId =
    typeof run.flow_version_id === "string"
      ? run.flow_version_id
      : metadataString(run.metadata, "flow_version_id");

  return {
    ...run,
    source_kind: getJobRunSourceKind(run),
    source_type: resolveFlowRunSourceType(
      run.metadata,
      flowVersionId,
      indexes.flowSourceTypeByVersionId
    ),
    repo: resolveFlowRunRepo(run.metadata, indexes.reposById),
    agent: {
      id: null,
      name: null,
      slug: null,
    },
    cost_usd: run.cost_usd ?? null,
    latest_ai_call: null,
    repairable: isRepairableJobRun(run),
    requeueable: isRequeueableJobRun(run),
    cancelable: isCancelableJobRun(run),
    active_wait_count: indexes.activeWaitCountByJobId.get(run.id) ?? 0,
    latest_dispatch_event: indexes.latestDispatchByJobId.get(run.id) || null,
    node_runs: indexes.nodeRunsByJobId.get(run.id) || [],
  };
}

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

export async function createFlowForUser(input: {
  userId: string;
  installationId: number;
  name?: string | null;
  templateId?: FlowStarterTemplateId | null;
  personalTemplateId?: string | null;
  teamTemplateId?: string | null;
  teamId?: string | null;
  repository?: string | null;
}) {
  if (isFlowsE2ETestMode()) {
    return createFlowForUserTest(input);
  }

  const installation = await loadOwnedInstallationProd(
    input.userId,
    input.installationId
  );
  if (!installation) {
    throw new FlowServiceError(
      "FLOW_INSTALLATION_NOT_FOUND",
      "Installation not found"
    );
  }

  const repository = input.repository?.trim() || null;
  if (repository) {
    const { data: ownedRepo, error: ownedRepoError } = await supabaseAdmin
      .from("repos")
      .select("id")
      .eq("user_id", input.userId)
      .eq("full_name", repository)
      .eq("github_installation_id", input.installationId)
      .maybeSingle();
    if (ownedRepoError) {
      throw new FlowServiceError(
        "FLOW_STORAGE_FAILED",
        `Failed to validate workflow repository: ${ownedRepoError.message}`,
        { cause: ownedRepoError }
      );
    }
    if (!ownedRepo) {
      throw new FlowServiceError(
        "FLOW_INSTALLATION_NOT_FOUND",
        "Repository not found for this GitHub account"
      );
    }
  }

  const personalTemplate = input.personalTemplateId
    ? await loadOwnedPersonalFlowTemplateProd(
        input.userId,
        input.personalTemplateId
      )
    : null;
  const teamTemplate =
    input.teamTemplateId && input.teamId
      ? await loadFlowTemplateProd(
          {
            kind: "team",
            userId: input.userId,
            productTeamId: input.teamId,
          },
          input.teamTemplateId
        )
      : null;
  if (input.personalTemplateId && !personalTemplate) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Workflow template not found");
  }
  if (input.teamTemplateId && !teamTemplate) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Workflow template not found");
  }
  const storedTemplate = personalTemplate ?? teamTemplate;
  if (
    storedTemplate &&
    flowTemplateRequiresRepository(storedTemplate.graph) &&
    !repository
  ) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      "This workflow template requires a repository."
    );
  }

  const baseDraft = storedTemplate
    ? {
        name: input.name?.trim() || storedTemplate.name,
        description: storedTemplate.description,
        draftGraph: storedTemplate.graph,
      }
    : await buildDefaultFlowDraftProd(input);
  const draft = {
    ...baseDraft,
    draftGraph: bindFlowGraphToScope(baseDraft.draftGraph, {
      installationId: input.installationId,
      repository,
    }),
  };
  const validation = validateFlowGraph(
    storedTemplate
      ? preparePersonalFlowTemplateGraphForValidation(draft.draftGraph)
      : draft.draftGraph,
    { requireRunnableConfig: Boolean(personalTemplate) }
  );
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      validation.errors[0] || "Workflow template is invalid",
      { details: validation.errors }
    );
  }
  await assertOwnedFlowGraphAgents(input.userId, draft.draftGraph);

  const { data, error } = await supabaseAdmin
    .from("flows")
    .insert({
      user_id: input.userId,
      installation_id: input.installationId,
      name: draft.name,
      description: draft.description,
      source_kind: "github",
      status: "inactive",
      draft_graph: draft.draftGraph,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return loadOwnedFlowProd(input.userId, data.id);
}

export async function listOwnedPersonalFlowTemplates(
  userId: string,
  cursor = 0
) {
  if (isFlowsE2ETestMode()) {
    return listOwnedPersonalFlowTemplatesTest(userId, cursor);
  }
  return listOwnedPersonalFlowTemplatesProd(userId, cursor);
}

export async function listFlowTemplates(
  scope: ProductResourceScope,
  cursor = 0
) {
  if (isFlowsE2ETestMode()) {
    return listFlowTemplatesTest(scope, cursor);
  }
  return listFlowTemplatesProd(scope, cursor);
}

export async function createFlowTemplate(input: {
  userId: string;
  flowId: string;
  name?: string | null;
  scope: ProductResourceScope;
}) {
  if (isFlowsE2ETestMode()) {
    return createFlowTemplateTest(input);
  }
  return createFlowTemplateProd(input);
}

export async function createPersonalFlowTemplate(input: {
  userId: string;
  flowId: string;
  name?: string | null;
}) {
  if (isFlowsE2ETestMode()) {
    return createPersonalFlowTemplateTest(input);
  }
  return createPersonalFlowTemplateProd(input);
}

export async function deleteFlowTemplate(
  scope: ProductResourceScope,
  templateId: string
) {
  if (isFlowsE2ETestMode()) {
    return deleteFlowTemplateTest(scope, templateId);
  }
  return deleteFlowTemplateProd(scope, templateId);
}

export async function loadOwnedFlow(userId: string, flowId: string) {
  if (isFlowsE2ETestMode()) {
    return loadOwnedFlowTest(userId, flowId);
  }

  return loadOwnedFlowProd(userId, flowId);
}

/** Validate an installation id and confirm the caller owns it, if supplied. */
async function assertOwnedInstallation(
  userId: string,
  installationId: number | undefined
) {
  if (installationId === undefined) return;

  if (!Number.isFinite(installationId) || installationId <= 0) {
    throw new FlowServiceError(
      "FLOW_INVALID_INSTALLATION_ID",
      "Invalid installation_id"
    );
  }

  const installation = await loadOwnedInstallationProd(userId, installationId);
  if (!installation) {
    throw new FlowServiceError(
      "FLOW_INSTALLATION_NOT_FOUND",
      "Installation not found"
    );
  }
}

/** Only fields the caller actually supplied are patched. */
function buildFlowUpdatePatch(input: {
  name?: string;
  description?: string | null;
  notes?: string | null;
  installationId?: number;
}): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof input.name === "string" && input.name.trim()) {
    updates.name = input.name.trim();
  }
  if (input.description !== undefined) updates.description = input.description;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (typeof input.installationId === "number") {
    updates.installation_id = input.installationId;
  }

  return updates;
}

export async function updateFlow(input: {
  userId: string;
  flowId: string;
  name?: string;
  description?: string | null;
  notes?: string | null;
  installationId?: number;
  draftGraph?: FlowGraph;
  // Verified active-team scope from the request header (null/omitted =
  // personal). Threaded into preset fork resolution so the immutable fork is
  // stamped with the same scope the UI displayed the preset model under.
  teamId?: string | null;
}) {
  if (isFlowsE2ETestMode()) {
    return updateFlowTest(input);
  }

  const flow = await loadOwnedFlowProd(input.userId, input.flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  await assertOwnedInstallation(input.userId, input.installationId);

  const updates = buildFlowUpdatePatch(input);

  // Resolve preset agent IDs (e.g. "preset:NEXTJS-REVIEWER") into real
  // user-owned agent rows before ownership verification and persistence.
  // resolvedGraph is always a complete FlowGraph when input.draftGraph is
  // provided — resolveFlowGraphPresetAgents throws rather than returning null
  // on failure, so the update is aborted cleanly if resolution fails.
  if (input.draftGraph) {
    const resolvedGraph = await resolveFlowGraphPresetAgents(
      input.userId,
      input.draftGraph,
      undefined,
      input.teamId ?? null
    );
    await assertOwnedFlowGraphAgents(input.userId, resolvedGraph);
    updates.draft_graph = resolvedGraph;
  }

  const data = unwrapOrThrow(
    await supabaseAdmin
      .from("flows")
      .update(updates)
      .eq("id", input.flowId)
      .eq("user_id", input.userId)
      .select("*")
      .single()
  );

  return loadOwnedFlowProd(input.userId, data.id);
}

export async function syncFlowActivation(
  userId: string,
  flowId: string,
  status: "active" | "inactive"
) {
  if (isFlowsE2ETestMode()) {
    return syncFlowActivationTest(userId, flowId, status);
  }

  return syncFlowActivationProd(userId, flowId, status);
}

export async function publishFlowDraft(
  userId: string,
  flowId: string,
  teamId: string | null = null
) {
  if (isFlowsE2ETestMode()) {
    return publishFlowDraftTest(userId, flowId);
  }

  return publishFlowDraftProd(userId, flowId, teamId);
}

export async function duplicateFlow(
  userId: string,
  flowId: string,
  teamId: string | null = null
) {
  if (isFlowsE2ETestMode()) {
    return duplicateFlowTest(userId, flowId);
  }

  return duplicateFlowProd(userId, flowId, teamId);
}

export async function deleteFlow(userId: string, flowId: string) {
  if (isFlowsE2ETestMode()) {
    return deleteFlowTest(userId, flowId);
  }

  return deleteFlowProd(userId, flowId);
}

// AI Gateway / ai_models catalog id — resolves to Anthropic Claude Sonnet 4.6
// via resolveUserLanguageModel. Not the direct Anthropic API model slug.
// See scripts/016_seed_ai_models.sql for the mapping.
const FLOW_ASSISTANT_MODEL_ID = "anthropic/claude-sonnet-4.6";

// A complex flow with 10+ nodes, conditions, and parallel branches typically
// takes ~15-25 tool calls. 40 leaves headroom for finalize re-runs when the
// first validation pass flags errors the model needs to fix.
const FLOW_ASSISTANT_MAX_STEPS = 40;

const FLOW_ASSISTANT_SYSTEM_PROMPT = [
  "You help users design deterministic repo automation workflows on a node canvas.",
  "Build the flow by calling tools that mutate a working graph. Do not emit prose — call tools only.",
  "Always ensure exactly one start node and exactly one end node exist. Use setStart and setEnd for those.",
  "Supported node types: start, agent, action, condition (presented as 'If'), parallel, join, delay (presented as 'Wait'), await_event (presented as 'Await event'), set_variable (presented as 'Set variable'), transform (presented as 'Transform'), end.",
  "Start events include GitHub events plus schedule, signed webhook, and Slack mention. schedule, webhook, and slack_mention must scope exactly one owner/repo. Dependabot automation is pr_opened with authorFilter=dependabot_only.",
  "Agent nodes must use an agentId from the available agents list. Roles: review (analysis), edit (apply changes after review), triage (classification/response).",
  "Use If (condition) nodes for then/else branching: connect the 'true' handle to the then branch and the 'false' handle to the else branch. Pass `rules` (with optional `mode: \"all\" | \"any\"`) for multi-rule logic; the legacy field/operator/value triple still works for one-rule branches. Use parallel for fan-out, join for fan-in, delay (Wait) for fixed-time pauses, and await_event for GitHub labels or comments, CI completion, Vercel preview readiness, or a manual approval.",
  "Join policies: wait_for_all (default) merges once every branch reports; wait_for_any emits as soon as the first active branch arrives and ignores later branches; quorum emits once `quorum` active branches have reported, and skips downstream when that becomes impossible. Quorum must be at least 2 and at most the number of incoming edges.",
  "Set variable nodes write deterministic values into per-run state. Each assignment has a key and a template; a whole-string `{{ path }}` template preserves the source type while mixed text interpolates as a string. Templates resolve against metadata, repo, outputs, outputs_by_label, previous_outputs, and the current state. Downstream If nodes read these as `state.<key>`. Prefer set_variable + If over a triage agent when the decision is purely metadata-driven.",
  "Transform nodes derive typed state without an agent call. Use copy, string_contains, string_split, array_join, array_length, array_includes, files_match_glob, cast_boolean, or cast_number against a source path, then read the result as `state.<key>`. Use separate Transform nodes when one derived value must feed another.",
  "Action nodes perform deterministic side effects. Available actions run a static sandbox command, send a templated Slack message to a selected channel or the triggering thread, post a GitHub issue/PR comment, create a GitHub issue, add/remove GitHub labels, set a commit status, submit a PR review, or request a safe squash merge after the workflow completes. GitHub actions are always restricted to the workflow repository. Leave their target number or commit SHA unset to use the triggering entity.",
  "Keep labels concise and preserve the user's intent. Do not invent trigger events.",
  "When you are finished and the graph is complete and connected from start to end, call finalize with a short summary.",
].join("\n");

// Conversational variant of the flow-assistant prompt used by the in-canvas
// chat panel (`/api/flows/[id]/chat`). Unlike `FLOW_ASSISTANT_SYSTEM_PROMPT`
// this allows prose replies (questions, explanations, confirmations) alongside
// tool calls, and does not force a `finalize` call.
const FLOW_ASSISTANT_CHAT_SYSTEM_PROMPT = [
  "You are the Flow assistant for a node-based repo automation canvas. You help the user design and edit a deterministic flow by both talking to them and calling tools that mutate a working graph.",
  "You may reply in prose: ask clarifying questions, explain trade-offs, and confirm before making large or destructive changes (e.g. removing several nodes or rewiring the whole flow). For small, clearly-requested edits, just make them.",
  "Build and edit the flow by calling the provided tools. After you change the graph, briefly tell the user in prose what you changed.",
  "Always keep exactly one start node and exactly one end node. Use setStart and setEnd for those.",
  "Supported node types: start, agent, action, condition (presented as 'If'), parallel, join, delay (presented as 'Wait'), await_event (presented as 'Await event'), set_variable (presented as 'Set variable'), transform (presented as 'Transform'), end.",
  "Start events include GitHub events plus schedule, signed webhook, and Slack mention. schedule, webhook, and slack_mention must scope exactly one owner/repo. Dependabot automation is pr_opened with authorFilter=dependabot_only.",
  "Agent nodes must use an agentId from the available agents list. Roles: review (analysis), edit (apply changes after review), triage (classification/response).",
  "Use If (condition) nodes for then/else branching: connect the 'true' handle to the then branch and the 'false' handle to the else branch. Pass `rules` (with optional `mode: \"all\" | \"any\"`) for multi-rule logic; the legacy field/operator/value triple still works for one-rule branches. Use parallel for fan-out, join for fan-in, delay (Wait) for fixed-time pauses, and await_event for GitHub labels or comments, CI completion, Vercel preview readiness, or a manual approval.",
  "Join policies: wait_for_all (default) merges once every branch reports; wait_for_any emits as soon as the first active branch arrives; quorum emits once `quorum` active branches have reported. Quorum must be at least 2 and at most the number of incoming edges.",
  "Set variable nodes write deterministic values into per-run state; downstream If nodes read them as `state.<key>`. Prefer set_variable + If over a triage agent when the decision is purely metadata-driven.",
  "Transform nodes derive typed state without an agent call using copy, string/array helpers, changed-file glob matching, and boolean/number casts. Results are available downstream as `state.<key>`.",
  "Action nodes perform deterministic side effects in the workflow repository: static sandbox commands, Slack channel/thread messages, GitHub comments, issues, labels, commit statuses, and PR reviews. Prefer these over an agent when the exact side effect is already known.",
  "Keep labels concise and preserve the user's intent. Do not invent trigger events. Call getGraphState before inspecting or editing the live canvas graph. After getGraphState returns, use getGraph whenever you need to inspect the working graph again.",
  "When the graph is complete and connected from start to end, you may call finalize with a short summary, but it is not required for the user to apply your changes.",
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractLatestFlowAssistantGraphState(
  messages: Parameters<typeof convertToModelMessages>[0]
): FlowGraph | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex] as UIMessage;
    if (!Array.isArray(message.parts)) continue;
    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.parts[partIndex];
      if (
        !isRecord(part) ||
        part.type !== FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE ||
        part.state !== "output-available"
      ) {
        continue;
      }
      const output = part.output;
      if (!isRecord(output)) continue;
      return coerceGraph(output.graph);
    }
  }
  return null;
}

function buildFlowAssistantResultData(
  working: ReturnType<ReturnType<typeof createFlowAssistantTools>["getResult"]>
): FlowAssistantResultData {
  if (!working.hydrated) {
    return {
      graph: null,
      summary: working.summary,
      finalized: working.done,
      valid: false,
      errors: ["The live canvas graph was not loaded."],
    };
  }

  try {
    const graph = coerceGraph(working.graph);
    const validation = validateFlowGraph(graph, {
      requireRunnableConfig: true,
    });
    return {
      graph,
      summary: working.summary,
      finalized: working.done,
      valid: validation.valid,
      errors: validation.valid ? null : validation.errors,
    };
  } catch (error) {
    return {
      graph: null,
      summary: working.summary,
      finalized: working.done,
      valid: false,
      errors: [
        error instanceof Error
          ? error.message
          : "Assistant produced an unreadable graph.",
      ],
    };
  }
}

/**
 * Streams a multi-turn chat for the in-canvas Flow assistant. Reuses the same
 * tool set as {@link generateFlowAssistantSuggestion}; the resulting working
 * graph is sent as a one-turn data part so later requests can prune it.
 */
export async function streamFlowAssistantChat(input: {
  userId: string;
  flowId: string;
  teamId?: string | null;
  capabilities?: ReadonlySet<Capability>;
  messages: Parameters<typeof convertToModelMessages>[0];
}): Promise<Response> {
  if (isFlowsE2ETestMode()) {
    throw new FlowServiceError(
      "FLOW_NOT_FOUND",
      "Flow assistant chat is not available in test mode"
    );
  }

  const flow = await loadOwnedFlowProd(input.userId, input.flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  const { data: agents, error: agentsError } = await supabaseAdmin
    .from("agents")
    .select("id, name, slug")
    .eq("user_id", input.userId)
    .order("name", { ascending: true });

  if (agentsError) {
    throw new Error(agentsError.message);
  }

  const allowedAgents = (agents ?? []).map((agent) => ({
    id: agent.id as string,
    name: agent.name as string,
    slug: agent.slug as string,
  }));

  const gatewayContext = {
    userId: input.userId,
    tags: ["surface:flow_assistant", `flow:${input.flowId}`],
  };
  const { model, providerOptions } = await resolveUserLanguageModel(
    input.userId,
    FLOW_ASSISTANT_MODEL_ID,
    {
      gatewayContext,
      teamId: input.teamId ?? null,
      capabilities: input.capabilities,
    }
  );

  const graph = extractLatestFlowAssistantGraphState(input.messages);
  // Constrain the assistant's model choice to what this scope can invoke; an
  // unusable read degrades to "unconstrained" rather than blocking the chat.
  const allowedModelIds = await listUsableModelIdsForScope(input.userId, {
    teamId: input.teamId ?? null,
  }).catch((error) => {
    console.error("[flows] failed to load usable models for assistant", error);
    return [] as string[];
  });
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: graph,
    allowedAgents,
    allowedModelIds,
    includeGraphStateTool: true,
  });

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  // Capture step usage as samples so overlapping callbacks cannot drop a merge.
  // The reduced step total remains fallback-only; final stream totals win.
  const observedStepUsages: CapturedUsage[] = [];
  const result = streamText({
    model,
    providerOptions,
    system: [
      FLOW_ASSISTANT_CHAT_SYSTEM_PROMPT,
      `Current flow name: ${flow.name}`,
      `Available agents: ${JSON.stringify(allowedAgents)}`,
    ].join("\n\n"),
    messages: await convertToModelMessages(input.messages),
    tools,
    stopWhen: stepCountIs(FLOW_ASSISTANT_MAX_STEPS),
    async onStepFinish(event) {
      observedStepUsages.push(
        captureUsage(event.usage, event.providerMetadata)
      );
    },
    async onFinish({ totalUsage, providerMetadata, finishReason, steps }) {
      const observedUsage = observedStepUsages.reduce(
        (usage, stepUsage) => mergeUsage(usage, stepUsage),
        EMPTY_CAPTURED_USAGE
      );
      const totalCapturedUsage = captureUsage(
        totalUsage as LanguageModelUsage | undefined,
        providerMetadata
      );
      // Union generation IDs from both sources to capture any ID that the SDK
      // surfaces only on the final aggregate (not per-step).
      await recordAiCallTelemetry({
        userId: input.userId,
        type: "agent",
        model: FLOW_ASSISTANT_MODEL_ID,
        usage: fillUsageGaps(
          {
            ...totalCapturedUsage,
            generationId:
              observedUsage.generationId ?? totalCapturedUsage.generationId,
            generationIds: [
              ...new Set([
                ...observedUsage.generationIds,
                ...totalCapturedUsage.generationIds,
              ]),
            ],
          },
          observedUsage
        ),
        startedAtMs,
        startedAt,
        status: finishReason === "error" ? "failed" : "success",
        error: finishReason === "error" ? "Flow assistant stream failed" : null,
        metadata: {
          surface: "flow_assistant",
          flow_id: input.flowId,
          mode: "chat",
          finish_reason: finishReason,
          step_count: steps.length,
        },
        logPrefix: "[flow-assistant]",
      });
    },
  });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const uiStream = result.toUIMessageStream({
        sendFinish: false,
        messageMetadata: ({ part }) => {
          if (part.type !== "finish") return undefined;
          if (part.finishReason === "tool-calls") return undefined;
          const data = buildFlowAssistantResultData(getResult());
          return {
            flowAssistant: {
              summary: data.summary,
              finalized: data.finalized,
              valid: data.valid,
              errors: data.errors,
            },
          };
        },
      });
      for await (const part of uiStream) {
        writer.write(part);
      }
      const finishReason = await result.finishReason;
      const data = buildFlowAssistantResultData(getResult());
      if (data.graph) {
        writer.write({
          type: FLOW_ASSISTANT_RESULT_DATA_TYPE,
          data,
        });
      }
      const messageMetadata =
        finishReason === "tool-calls"
          ? undefined
          : {
              flowAssistant: {
                summary: data.summary,
                finalized: data.finalized,
                valid: data.valid,
                errors: data.errors,
              },
            };
      writer.write({
        type: "finish",
        finishReason,
        ...(messageMetadata ? { messageMetadata } : {}),
      });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/**
 * Merge per-step usage with the final aggregate. Generation IDs are unioned
 * from both sources because the SDK surfaces some only on the aggregate.
 */
function mergeFlowAssistantUsage(
  observedStepUsages: readonly CapturedUsage[],
  generation: { totalUsage?: unknown; providerMetadata?: unknown }
) {
  const observedUsage = observedStepUsages.reduce(
    (usage, stepUsage) => mergeUsage(usage, stepUsage),
    EMPTY_CAPTURED_USAGE
  );
  const totalCapturedUsage = captureUsage(
    generation.totalUsage as LanguageModelUsage | undefined,
    generation.providerMetadata as ProviderMetadata | undefined
  );

  return fillUsageGaps(
    {
      ...totalCapturedUsage,
      generationId:
        observedUsage.generationId ?? totalCapturedUsage.generationId,
      generationIds: [
        ...new Set([
          ...observedUsage.generationIds,
          ...totalCapturedUsage.generationIds,
        ]),
      ],
    },
    observedUsage
  );
}

/** The tool loop must reach `finalize`; anything else is a failed suggestion. */
function flowAssistantIncompleteError(stepsTaken: number): FlowServiceError {
  return new FlowServiceError(
    "FLOW_ASSISTANT_INVALID_GRAPH",
    stepsTaken >= FLOW_ASSISTANT_MAX_STEPS
      ? `Assistant ran out of steps (${stepsTaken}/${FLOW_ASSISTANT_MAX_STEPS}) before completing the flow. Try a simpler request or break it into smaller changes.`
      : "Assistant stopped before finalizing a flow graph. Try rephrasing your request."
  );
}

export async function generateFlowAssistantSuggestion(input: {
  userId: string;
  flowId: string;
  teamId?: string | null;
  capabilities?: ReadonlySet<Capability>;
  message: string;
  graph: FlowGraph;
}) {
  if (isFlowsE2ETestMode()) {
    return generateFlowAssistantSuggestionTest(input);
  }

  const flow = await loadOwnedFlowProd(input.userId, input.flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  const agents = unwrapRowsOrThrow(
    await supabaseAdmin
      .from("agents")
      .select("id, name, slug")
      .eq("user_id", input.userId)
      .order("name", { ascending: true })
  );

  const gatewayContext = {
    userId: input.userId,
    tags: ["surface:flow_assistant", `flow:${input.flowId}`],
  };
  const { model, providerOptions } = await resolveUserLanguageModel(
    input.userId,
    FLOW_ASSISTANT_MODEL_ID,
    {
      gatewayContext,
      teamId: input.teamId ?? null,
      capabilities: input.capabilities,
    }
  );

  const allowedAgents = agents.map((agent) => ({
    id: agent.id as string,
    name: agent.name as string,
    slug: agent.slug as string,
  }));

  const allowedModelIds = await listUsableModelIdsForScope(input.userId, {
    teamId: input.teamId ?? null,
  }).catch((error) => {
    console.error("[flows] failed to load usable models for assistant", error);
    return [] as string[];
  });

  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: input.graph,
    allowedAgents,
    allowedModelIds,
  });

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  // Capture step usage to accumulate all generation IDs across tool-loop steps.
  const observedStepUsages: CapturedUsage[] = [];
  const generation = await generateText({
    model,
    providerOptions,
    system: FLOW_ASSISTANT_SYSTEM_PROMPT,
    prompt: [
      `User request: ${input.message}`,
      `Current flow name: ${flow.name}`,
      `Current graph JSON: ${JSON.stringify(input.graph)}`,
      `Available agents: ${JSON.stringify(allowedAgents)}`,
      "When the flow is correct and connected from start to end, call finalize with a short summary. Do not emit prose — call tools only.",
    ].join("\n\n"),
    tools,
    stopWhen: stepCountIs(FLOW_ASSISTANT_MAX_STEPS),
    onStepFinish(event) {
      observedStepUsages.push(
        captureUsage(event.usage, event.providerMetadata)
      );
    },
  });
  await recordAiCallTelemetry({
    userId: input.userId,
    type: "agent",
    model: FLOW_ASSISTANT_MODEL_ID,
    usage: mergeFlowAssistantUsage(observedStepUsages, generation),
    startedAtMs,
    startedAt,
    status: "success",
    metadata: {
      surface: "flow_assistant",
      flow_id: input.flowId,
      mode: "suggestion",
      finish_reason: generation.finishReason,
      step_count: generation.steps.length,
    },
    logPrefix: "[flow-assistant]",
  });

  const result = getResult();
  if (!result.done) {
    throw flowAssistantIncompleteError(generation.steps?.length ?? 0);
  }

  const graph = coerceGraph(result.graph);
  const validation = validateFlowGraph(graph, { requireRunnableConfig: true });
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_ASSISTANT_INVALID_GRAPH",
      "Assistant produced an invalid flow graph",
      { details: validation.errors }
    );
  }

  await assertOwnedFlowGraphAgents(input.userId, graph);

  return {
    summary: result.summary ?? "",
    graph,
  };
}
