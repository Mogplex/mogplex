/**
 * Presents external agent runs (API, MCP, CLI, Slack) as observability jobs so
 * the Runs table shows every run a user started, not only automation runs.
 *
 * Agent runs live in `external_agent_runs` with one backing `ai_calls` row
 * that carries tokens, cost, timing and the tool-call count. The two are
 * joined here into the same `ObservabilityJob` shape the Runs table renders.
 */
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import type { AiCall, ObservabilityJob } from "@/lib/types";
import type { UserAutomationScope } from "@/lib/user-automation-scope";

export const AGENT_RUN_SOURCE_KIND = "agent_run" as const;

export const AGENT_RUN_QUERY_LIMIT = 10000;

// PostgREST serializes `.in()` filters into the request URL, so the backing
// call lookup runs in bounded batches instead of one filter over every run.
export const AGENT_RUN_AI_CALL_BATCH_SIZE = 200;

export type AgentRunAiCallSummary = Pick<
  AiCall,
  | "id"
  | "status"
  | "model"
  | "input_tokens"
  | "output_tokens"
  | "total_tokens"
  | "cost_usd"
  | "duration_ms"
  | "tool_calls_count"
  | "started_at"
  | "completed_at"
>;

export const AGENT_RUN_AI_CALL_SELECT =
  "id, status, model, input_tokens, output_tokens, total_tokens, cost_usd, duration_ms, tool_calls_count, started_at, completed_at";

export type AgentRunJobFilters = {
  status?: string | null;
  from?: string | null;
  to?: string | null;
};

export type LoadAgentRunRowsInput = {
  userId: string;
  status: string | null;
  from: string | undefined;
  to: string | undefined;
};

export type AgentRunJobsDeps = {
  loadRows: (input: LoadAgentRunRowsInput) => Promise<ExternalAgentRunRow[]>;
  loadAiCalls: (aiCallIds: string[]) => Promise<AgentRunAiCallSummary[]>;
};

const TERMINAL_AGENT_RUN_STATUSES = new Set(["success", "failed", "cancelled"]);

export function mapAgentRunStatus(
  status: ExternalAgentRunRow["status"] | string
): ObservabilityJob["status"] {
  switch (status) {
    case "streaming":
      return "running";
    case "pending":
    case "success":
    case "failed":
    case "cancelled":
      return status;
    default:
      return "failed";
  }
}

/** Agent runs only need loading when the source filter can include them. */
export function shouldLoadAgentRunJobs(
  sourceKind: string | null | undefined
): boolean {
  return !sourceKind || sourceKind === AGENT_RUN_SOURCE_KIND;
}

/** Runs use `streaming` where the Runs table filter says `running`. */
export function resolveAgentRunStatusFilter(
  status: string | null | undefined
): string | null {
  if (!status) return null;
  return status === "running" ? "streaming" : status;
}

function getAgentRunSourceType(run: ExternalAgentRunRow): string {
  const metadata = run.metadata ?? {};
  if (metadata.slack && typeof metadata.slack === "object") return "slack";
  return "api";
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type AgentRunRepo = { id: string; full_name: string | null } | null;

function buildAgentRunMetadata(
  run: ExternalAgentRunRow,
  repo: AgentRunRepo
): Record<string, unknown> {
  return {
    ...run.metadata,
    repo_id: run.repo_id,
    repo_full_name: repo?.full_name ?? null,
    harness: run.harness,
    ai_call_id: run.ai_call_id,
    base_branch: run.base_branch,
    working_branch: run.working_branch,
    sandbox_id: run.sandbox_id,
    prompt: run.prompt,
  };
}

function buildAgentRunLatestAiCall(
  aiCall: AgentRunAiCallSummary | null
): ObservabilityJob["latest_ai_call"] {
  if (!aiCall) return null;
  return {
    id: aiCall.id,
    status: aiCall.status,
    model: aiCall.model,
    total_tokens: aiCall.total_tokens,
    tool_calls_count: aiCall.tool_calls_count,
    started_at: aiCall.started_at,
  };
}

function buildAgentRunUsage(aiCall: AgentRunAiCallSummary | null) {
  return {
    input_tokens: aiCall?.input_tokens ?? null,
    output_tokens: aiCall?.output_tokens ?? null,
    cost_usd: toFiniteNumber(aiCall?.cost_usd),
    duration_ms: aiCall?.duration_ms ?? null,
  };
}

function buildAgentRunTiming(
  run: ExternalAgentRunRow,
  aiCall: AgentRunAiCallSummary | null
) {
  const isTerminal = TERMINAL_AGENT_RUN_STATUSES.has(run.status);
  return {
    created_at: run.created_at,
    started_at: aiCall?.started_at ?? null,
    completed_at: aiCall?.completed_at ?? (isTerminal ? run.updated_at : null),
    last_start_attempt_at: run.created_at,
    cancelled_at: run.status === "cancelled" ? run.updated_at : null,
  };
}

export function buildAgentRunObservabilityJob(
  scope: UserAutomationScope,
  run: ExternalAgentRunRow,
  aiCall: AgentRunAiCallSummary | null
): ObservabilityJob {
  const repo = scope.reposById.get(run.repo_id) ?? null;

  return {
    id: run.id,
    assignment_id: null,
    trigger_id: null,
    flow_id: null,
    flow_version_id: null,
    runtime_provider: run.runtime_provider === "trigger" ? "trigger" : null,
    runtime_run_id: run.runtime_run_id,
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: mapAgentRunStatus(run.status),
    ...buildAgentRunTiming(run, aiCall),
    ...buildAgentRunUsage(aiCall),
    error: run.error,
    start_attempts: 1,
    last_start_error: null,
    last_start_source: null,
    cancel_requested_at: null,
    cancel_reason: null,
    cancel_error: null,
    metadata: buildAgentRunMetadata(run, repo),
    source_kind: AGENT_RUN_SOURCE_KIND,
    source_type: getAgentRunSourceType(run),
    repo: {
      id: run.repo_id,
      full_name: repo?.full_name ?? null,
    },
    agent: {
      id: null,
      name: run.harness,
      slug: null,
    },
    latest_ai_call: buildAgentRunLatestAiCall(aiCall),
    latest_dispatch_event: null,
    repairable: false,
    requeueable: false,
    cancelable: false,
  };
}

async function loadAgentRunRowsFromDb(
  input: LoadAgentRunRowsInput
): Promise<ExternalAgentRunRow[]> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  let query = supabaseAdmin
    .from("external_agent_runs")
    .select("*")
    .eq("user_id", input.userId);
  if (input.status) query = query.eq("status", input.status);
  if (input.from) query = query.gte("created_at", input.from);
  if (input.to) query = query.lte("created_at", input.to);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AGENT_RUN_QUERY_LIMIT);
  if (error) {
    throw new Error(`Failed to load agent runs: ${error.message}`);
  }
  return (data ?? []) as ExternalAgentRunRow[];
}

async function loadAgentRunAiCallsFromDb(
  aiCallIds: string[]
): Promise<AgentRunAiCallSummary[]> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin
    .from("ai_calls")
    .select(AGENT_RUN_AI_CALL_SELECT)
    .in("id", aiCallIds)
    .limit(AGENT_RUN_QUERY_LIMIT);
  if (error) {
    throw new Error(`Failed to load agent run calls: ${error.message}`);
  }
  return (data ?? []) as AgentRunAiCallSummary[];
}

const defaultAgentRunJobsDeps: AgentRunJobsDeps = {
  loadRows: loadAgentRunRowsFromDb,
  loadAiCalls: loadAgentRunAiCallsFromDb,
};

export async function loadUserAgentRunJobs(
  input: {
    userId: string;
    scope: UserAutomationScope;
    filters: AgentRunJobFilters;
  },
  deps: AgentRunJobsDeps = defaultAgentRunJobsDeps
): Promise<ObservabilityJob[]> {
  const rows = await deps.loadRows({
    userId: input.userId,
    status: resolveAgentRunStatusFilter(input.filters.status),
    from: input.filters.from ?? undefined,
    to: input.filters.to ?? undefined,
  });
  if (rows.length === 0) return [];

  const aiCallsById = new Map<string, AgentRunAiCallSummary>();
  const aiCallIds = rows.map((row) => row.ai_call_id);
  for (let i = 0; i < aiCallIds.length; i += AGENT_RUN_AI_CALL_BATCH_SIZE) {
    const batch = await deps.loadAiCalls(
      aiCallIds.slice(i, i + AGENT_RUN_AI_CALL_BATCH_SIZE)
    );
    for (const aiCall of batch) aiCallsById.set(aiCall.id, aiCall);
  }

  return rows.map((row) =>
    buildAgentRunObservabilityJob(
      input.scope,
      row,
      aiCallsById.get(row.ai_call_id) ?? null
    )
  );
}
