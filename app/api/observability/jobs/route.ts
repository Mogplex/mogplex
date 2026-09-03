import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  buildObservabilityJob,
  loadUserJobRuns,
  resolveFlowVersionAttribution,
} from "@/lib/job-run-service";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";
import type { ObservabilityJob } from "@/lib/types";
import { loadUserAgentRunJobs } from "@/lib/observability/agent-run-jobs";
import { sanitizeObservabilityPayload } from "@/lib/observability/user-facing-errors";

type JobsFilters = {
  page: number;
  limit: number;
  sort: string;
  order: "asc" | "desc";
  status?: string;
  sourceKind?: string;
  sourceType?: string;
  repoId?: string;
  agentId?: string;
  onlyRepairable?: boolean;
  onlyRetried?: boolean;
  from?: string;
  to?: string;
};

function parseFilters(req: NextRequest): JobsFilters {
  const params = req.nextUrl.searchParams;
  return {
    page: Math.max(1, Number.parseInt(params.get("page") || "1")),
    limit: Math.min(
      100,
      Math.max(1, Number.parseInt(params.get("limit") || "50"))
    ),
    sort: params.get("sort") || "created_at",
    order: params.get("order") === "asc" ? "asc" : "desc",
    status: params.get("status") || undefined,
    sourceKind: params.get("source_kind") || undefined,
    sourceType: params.get("source_type") || undefined,
    repoId: params.get("repo_id") || undefined,
    agentId: params.get("agent_id") || undefined,
    onlyRepairable: params.get("only_repairable") === "true",
    onlyRetried: params.get("only_retried") === "true",
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
  };
}

function compareJobs(
  a: ObservabilityJob,
  b: ObservabilityJob,
  sort: string,
  order: "asc" | "desc"
) {
  const factor = order === "asc" ? 1 : -1;

  switch (sort) {
    case "status":
      return a.status.localeCompare(b.status) * factor;
    case "duration_ms":
      return ((a.duration_ms || 0) - (b.duration_ms || 0)) * factor;
    case "start_attempts":
      return (a.start_attempts - b.start_attempts) * factor;
    case "started_at":
      return (
        (new Date(a.started_at || a.created_at).getTime() -
          new Date(b.started_at || b.created_at).getTime()) *
        factor
      );
    case "completed_at":
      return (
        (new Date(a.completed_at || 0).getTime() -
          new Date(b.completed_at || 0).getTime()) *
        factor
      );
    case "created_at":
    default:
      return (
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
        factor
      );
  }
}

export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const filters = parseFilters(req);
  const { scope, runs } = await loadUserJobRuns(userId, {
    status: filters.status,
    from: filters.from,
    to: filters.to,
  });

  // Agent runs (API, MCP, CLI, Slack) are listed alongside automation runs so
  // every run the user started is visible here.
  const agentRunJobs = await loadUserAgentRunJobs({
    userId,
    scope,
    filters: { status: filters.status, from: filters.from, to: filters.to },
  });

  const jobs = [
    ...runs.map<ObservabilityJob>((run) => buildObservabilityJob(scope, run)),
    ...agentRunJobs,
  ].filter((job) => {
    if (filters.sourceKind && job.source_kind !== filters.sourceKind)
      return false;
    if (filters.sourceType && job.source_type !== filters.sourceType)
      return false;
    if (filters.repoId && job.repo.id !== filters.repoId) return false;
    if (filters.agentId) {
      if (job.flow_id) {
        const flowAttribution = resolveFlowVersionAttribution(scope, {
          flowId: job.flow_id,
          flowVersionId: job.flow_version_id,
          metadata: job.metadata,
        });
        if (flowAttribution?.agentIds.includes(filters.agentId) !== true) {
          return false;
        }
      } else if (job.agent.id !== filters.agentId) {
        return false;
      }
    }
    if (filters.onlyRepairable && !job.repairable) return false;
    if (filters.onlyRetried && !job.retry_of_job_run_id) return false;
    return true;
  });

  jobs.sort((a, b) => compareJobs(a, b, filters.sort, filters.order));

  const total = jobs.length;
  const paged = jobs.slice(
    (filters.page - 1) * filters.limit,
    filters.page * filters.limit
  );
  const jobIds = paged.map((job) => job.id);

  if (jobIds.length > 0) {
    const [
      { data: aiCalls, error: aiCallsError },
      { data: dispatchEvents, error: dispatchEventsError },
    ] = await Promise.all([
      supabaseAdmin
        .from("ai_calls")
        .select(
          "id, job_run_id, status, model, total_tokens, tool_calls_count, started_at"
        )
        .in("job_run_id", jobIds)
        .order("started_at", { ascending: false })
        .limit(10000),
      supabaseAdmin
        .from("automation_dispatch_events")
        .select(
          "id, job_run_id, event_kind, outcome, reason, metadata, created_at"
        )
        .in("job_run_id", jobIds)
        .order("created_at", { ascending: false })
        .limit(10000),
    ]);

    if (aiCallsError) {
      console.error("observability ai call summary query failed", aiCallsError);
      return NextResponse.json(
        { error: "Failed to fetch job details" },
        { status: 500 }
      );
    }
    if (dispatchEventsError) {
      console.error(
        "observability dispatch event query failed",
        dispatchEventsError
      );
      return NextResponse.json(
        { error: "Failed to fetch job details" },
        { status: 500 }
      );
    }

    const latestByJobId = new Map<string, (typeof aiCalls)[number]>();
    for (const aiCall of aiCalls || []) {
      if (!aiCall.job_run_id || latestByJobId.has(aiCall.job_run_id)) continue;
      latestByJobId.set(aiCall.job_run_id, aiCall);
    }

    const latestDispatchByJobId = new Map<
      string,
      NonNullable<ObservabilityJob["latest_dispatch_event"]>
    >();
    for (const event of dispatchEvents || []) {
      if (!event.job_run_id || latestDispatchByJobId.has(event.job_run_id))
        continue;
      latestDispatchByJobId.set(event.job_run_id, {
        id: event.id,
        event_kind: event.event_kind,
        outcome: event.outcome,
        reason: event.reason,
        metadata: event.metadata ?? null,
        created_at: event.created_at,
      });
    }

    for (const job of paged) {
      job.latest_ai_call = latestByJobId.get(job.id) || job.latest_ai_call;
      job.latest_dispatch_event = latestDispatchByJobId.get(job.id) || null;
    }
  }

  return NextResponse.json({
    jobs: paged.map((job) => sanitizeObservabilityPayload(job, "JOB", job.id)),
    total,
    page: filters.page,
    limit: filters.limit,
  });
}
