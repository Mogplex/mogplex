import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getJobRunSourceKind,
  isCancelableJobRun,
  isRepairableJobRun,
  isRequeueableJobRun,
} from "@/lib/job-runs";
import { listJobRunReviewFindings } from "@/lib/review-findings";
import {
  buildUserAutomationScope,
  createEmptyUserAutomationScope,
  getMetadataFlowVersionId,
  loadUserAutomationEntities,
  resolveFlowVersionAttribution,
} from "@/lib/user-automation-scope";
import type { BackgroundRuntimeProvider } from "@/lib/runtime-providers";
import type {
  FlowRunAiCallDetail,
  FlowRunDispatchTimelineEvent,
  ObservabilityJob,
  ObservabilityJobDetail,
} from "@/lib/types";
import type { UserAutomationEntities } from "@/lib/user-automation-scope";

// Re-export from sibling module to preserve public API
export type {
  FlowVersionAttribution,
  UserAutomationScope,
} from "@/lib/user-automation-scope";
export {
  loadUserAutomationScope,
  resolveFlowVersionAttribution,
} from "@/lib/user-automation-scope";

export type JobRunRow = {
  id: string;
  assignment_id: string | null;
  trigger_id: string | null;
  flow_id: string | null;
  flow_version_id: string | null;
  runtime_provider: BackgroundRuntimeProvider | null;
  runtime_run_id: string | null;
  workflow_run_id: string | null;
  retry_of_job_run_id: string | null;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | string | null;
  duration_ms: number | null;
  error: string | null;
  start_attempts: number;
  last_start_attempt_at: string | null;
  last_start_error: string | null;
  last_start_source:
    | "webhook"
    | "cron"
    | "repair"
    | "manual_retry"
    | "queue_release"
    | null;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancel_error: string | null;
  metadata: Record<string, unknown> | null;
};

const JOB_RUN_SELECT =
  "id, assignment_id, trigger_id, flow_id, flow_version_id, runtime_provider, runtime_run_id, workflow_run_id, retry_of_job_run_id, status, created_at, started_at, completed_at, input_tokens, output_tokens, cost_usd, duration_ms, error, start_attempts, last_start_attempt_at, last_start_error, last_start_source, cancel_requested_at, cancelled_at, cancel_reason, cancel_error, metadata";

// PostgREST applies a server-side `db-max-rows` cap (1,000,000 on this
// project as of 2026-07; previously 1,000) to every request. A single
// `.limit(n)` above the cap does NOT bypass it - the response is still
// clamped - so an account with more job runs than the cap gets a
// truncated, and without an explicit order arbitrarily-ordered, slice. When
// that slice omits the most recent runs, recency-sensitive aggregates silently
// break: the observability "Run Success" tile reads 0% even while runs are
// succeeding, because the selected window lands entirely outside the returned
// rows.
//
// We fix this two ways: (1) order newest-first with a unique tiebreaker so the
// returned window always starts at the most recent runs (recency metrics stay
// correct even at the cap), and (2) page with `.range()` in chunks at or below
// the server cap, accumulating across pages so totals are complete up to
// JOB_RUN_QUERY_LIMIT - well above any single user's realistic run volume.
export const JOB_RUN_PAGE_SIZE = 1000;
export const JOB_RUN_QUERY_LIMIT = 10000;

// Page through a scoped job-run query, accumulating rows across requests until a
// short page signals the end or the safety cap is reached. `fetchPage` performs
// one ordered, range-bounded read; keeping it injectable makes the paging and
// cap logic unit-testable without a live PostgREST endpoint.
export async function collectPagedRows(
  fetchPage: (offset: number, limit: number) => Promise<JobRunRow[]>,
  options?: { pageSize?: number; maxRows?: number }
): Promise<JobRunRow[]> {
  const pageSize = options?.pageSize ?? JOB_RUN_PAGE_SIZE;
  const maxRows = options?.maxRows ?? JOB_RUN_QUERY_LIMIT;
  const collected: JobRunRow[] = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const limit = Math.min(pageSize, maxRows - offset);
    const rows = await fetchPage(offset, limit);
    collected.push(...rows);
    if (rows.length < limit) break;
  }

  return collected;
}

// Merge per-scope pages into one set: dedupe by id (a run can match more than
// one scope) and sort newest-first across all scopes. created_at alone is not a
// total order, so id breaks ties - this keeps the merged list globally ordered
// rather than grouped by the scope it came from.
export function mergeJobRunPages(pages: JobRunRow[][]): JobRunRow[] {
  const deduped = new Map<string, JobRunRow>();
  for (const page of pages) {
    for (const run of page) {
      deduped.set(run.id, run);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? 1 : -1;
    }
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });
}

function normalizeOptionalFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function collectJobRunFlowVersionIds(
  runs: Array<Pick<JobRunRow, "flow_version_id" | "metadata">>
) {
  return Array.from(
    new Set(
      runs.flatMap((run) =>
        [run.flow_version_id, getMetadataFlowVersionId(run.metadata)].filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
      )
    )
  );
}

function doesJobRunBelongToUserAutomationEntities(
  run: Pick<JobRunRow, "assignment_id" | "trigger_id" | "flow_id">,
  entities: UserAutomationEntities
) {
  return (
    (run.assignment_id != null &&
      entities.assignments.some(
        (assignment) => assignment.id === run.assignment_id
      )) ||
    (run.trigger_id != null &&
      entities.triggers.some((trigger) => trigger.id === run.trigger_id)) ||
    (run.flow_id != null &&
      entities.flows.some((flow) => flow.id === run.flow_id))
  );
}

export async function loadUserJobRuns(
  userId: string,
  filters?: {
    status?: string | null;
    from?: string | null;
    to?: string | null;
  }
) {
  const entities = await loadUserAutomationEntities(userId);

  // Fetch one page of a scoped query. Filters (.eq/.gte/.lte/.in) must precede
  // the transforms (.order/.range), and the order pairs created_at with the
  // unique id so range pagination has a stable total order across pages. See
  // JOB_RUN_QUERY_LIMIT for why we page instead of relying on a single limit.
  const fetchScopedPage = async (
    column: "assignment_id" | "trigger_id" | "flow_id",
    ids: string[],
    offset: number,
    limit: number
  ): Promise<JobRunRow[]> => {
    let next = supabaseAdmin.from("job_runs").select(JOB_RUN_SELECT);
    if (filters?.status) next = next.eq("status", filters.status);
    if (filters?.from) next = next.gte("created_at", filters.from);
    if (filters?.to) next = next.lte("created_at", filters.to);
    const { data, error } = await next
      .in(column, ids)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) {
      throw new Error(`Failed to load job runs: ${error.message}`);
    }
    return (data ?? []) as JobRunRow[];
  };

  const scopeFetches: Array<Promise<JobRunRow[]>> = [];

  if (entities.assignments.length > 0) {
    const ids = entities.assignments.map((assignment) => assignment.id);
    scopeFetches.push(
      collectPagedRows((offset, limit) =>
        fetchScopedPage("assignment_id", ids, offset, limit)
      )
    );
  }

  if (entities.triggers.length > 0) {
    const ids = entities.triggers.map((trigger) => trigger.id);
    scopeFetches.push(
      collectPagedRows((offset, limit) =>
        fetchScopedPage("trigger_id", ids, offset, limit)
      )
    );
  }

  if (entities.flows.length > 0) {
    const ids = entities.flows.map((flow) => flow.id);
    scopeFetches.push(
      collectPagedRows((offset, limit) =>
        fetchScopedPage("flow_id", ids, offset, limit)
      )
    );
  }

  if (scopeFetches.length === 0) {
    return {
      scope: await buildUserAutomationScope(entities),
      runs: [] as JobRunRow[],
    };
  }

  const pages = await Promise.all(scopeFetches);
  const runs = mergeJobRunPages(pages);
  const scope = await buildUserAutomationScope(entities, {
    flowVersionIds: collectJobRunFlowVersionIds(runs),
  });

  return {
    scope,
    runs,
  };
}

export function buildObservabilityJob(
  scope: import("@/lib/user-automation-scope").UserAutomationScope,
  run: JobRunRow
): ObservabilityJob {
  const sourceKind = getJobRunSourceKind(run);
  const assignment = run.assignment_id
    ? scope.assignmentsById.get(run.assignment_id)
    : null;
  const trigger = run.trigger_id
    ? scope.triggersById.get(run.trigger_id)
    : null;
  const flowAttribution = resolveFlowVersionAttribution(scope, {
    flowId: run.flow_id,
    flowVersionId: run.flow_version_id,
    metadata: run.metadata,
  });
  const flowAgent = flowAttribution?.primaryAgentId
    ? scope.agentsById.get(flowAttribution.primaryAgentId)
    : null;
  const repo = assignment
    ? scope.reposById.get(assignment.repo_id)
    : typeof run.metadata?.repo_id === "string"
      ? scope.reposById.get(run.metadata.repo_id)
      : null;
  const agent = assignment
    ? scope.agentsById.get(assignment.agent_id)
    : trigger
      ? scope.agentsById.get(trigger.agent_id)
      : flowAgent;

  return {
    ...run,
    source_kind: sourceKind,
    source_type:
      trigger?.event ||
      assignment?.type ||
      (typeof run.metadata?.source_type === "string"
        ? run.metadata.source_type
        : null) ||
      flowAttribution?.sourceType ||
      "unknown",
    repo: {
      id:
        repo?.id ||
        (typeof run.metadata?.repo_id === "string"
          ? run.metadata.repo_id
          : null),
      full_name:
        repo?.full_name ||
        (typeof run.metadata?.repo_full_name === "string"
          ? run.metadata.repo_full_name
          : null),
    },
    agent: {
      id: agent?.id || null,
      name: agent?.name || null,
      slug: agent?.slug || null,
    },
    cost_usd: normalizeOptionalFiniteNumber(run.cost_usd),
    latest_ai_call: null,
    latest_dispatch_event: null,
    repairable: isRepairableJobRun(run),
    requeueable: isRequeueableJobRun(run),
    cancelable: isCancelableJobRun(run),
  };
}

export async function loadOwnedJobRun(userId: string, jobRunId: string) {
  const entities = await loadUserAutomationEntities(userId);
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select(JOB_RUN_SELECT)
    .eq("id", jobRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job run: ${error.message}`);
  }

  const run = (data as JobRunRow | null) ?? null;
  if (!run || !doesJobRunBelongToUserAutomationEntities(run, entities)) {
    return {
      scope: createEmptyUserAutomationScope(),
      run: null,
    };
  }

  const scope = await buildUserAutomationScope(entities, {
    flowVersionIds: collectJobRunFlowVersionIds([run]),
  });

  return {
    scope,
    run,
  };
}

export async function loadOwnedJobRunDetail(userId: string, jobRunId: string) {
  const { scope, run } = await loadOwnedJobRun(userId, jobRunId);

  if (!run) {
    return {
      scope,
      run: null,
    };
  }

  const [
    { data: aiCalls, error: aiCallsError },
    { data: dispatchEvents, error: dispatchError },
    reviewFindings,
  ] = await Promise.all([
    supabaseAdmin
      .from("ai_calls")
      .select("*")
      .eq("user_id", userId)
      .eq("job_run_id", jobRunId)
      .order("started_at", { ascending: true }),
    supabaseAdmin
      .from("automation_dispatch_events")
      .select("id, event_kind, outcome, reason, metadata, created_at")
      .eq("job_run_id", jobRunId)
      .order("created_at", { ascending: true }),
    listJobRunReviewFindings(jobRunId),
  ]);

  if (aiCallsError) {
    throw new Error(`Failed to load AI calls: ${aiCallsError.message}`);
  }

  if (dispatchError) {
    throw new Error(`Failed to load dispatch events: ${dispatchError.message}`);
  }

  const aiCallIds = (aiCalls || []).map((call) => call.id);
  const { data: aiCallEvents, error: aiCallEventsError } =
    aiCallIds.length > 0
      ? await supabaseAdmin
          .from("ai_call_events")
          .select("*")
          .in("ai_call_id", aiCallIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };

  if (aiCallEventsError) {
    throw new Error(
      `Failed to load AI call events: ${aiCallEventsError.message}`
    );
  }

  const aiCallEventsByCallId = new Map<string, typeof aiCallEvents>();
  for (const event of aiCallEvents || []) {
    const bucket = aiCallEventsByCallId.get(event.ai_call_id) || [];
    bucket.push(event);
    aiCallEventsByCallId.set(event.ai_call_id, bucket);
  }

  const dispatchTimeline = ((dispatchEvents || []).map((event) => ({
    id: event.id,
    event_kind: event.event_kind,
    outcome: event.outcome,
    reason: event.reason,
    metadata: event.metadata ?? null,
    created_at: event.created_at,
  })) || []) as FlowRunDispatchTimelineEvent[];
  const detailedAiCalls = ((aiCalls || []).map((call) => ({
    ...call,
    events: aiCallEventsByCallId.get(call.id) || [],
  })) || []) as FlowRunAiCallDetail[];

  return {
    scope,
    run: {
      ...buildObservabilityJob(scope, run),
      latest_ai_call:
        detailedAiCalls.length > 0
          ? {
              id: detailedAiCalls.at(-1)!.id,
              status: detailedAiCalls.at(-1)!.status,
              model: detailedAiCalls.at(-1)!.model,
              total_tokens: detailedAiCalls.at(-1)!.total_tokens,
              tool_calls_count: detailedAiCalls.at(-1)!.tool_calls_count,
              started_at: detailedAiCalls.at(-1)!.started_at,
            }
          : null,
      latest_dispatch_event:
        dispatchTimeline.length > 0 ? dispatchTimeline.at(-1)! : null,
      dispatch_events: dispatchTimeline,
      ai_calls: detailedAiCalls,
      review_findings: reviewFindings,
    } satisfies ObservabilityJobDetail,
  };
}
