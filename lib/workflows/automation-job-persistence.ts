/**
 * Job persistence helpers for the automation job workflow.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import { replaceJobRunReviewFindings } from "@/lib/review-findings";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { capturedUsageAiCallColumns } from "@/lib/observability/usage";
import {
  AUTOMATION_LIMITS,
  loadAutomationScopesByStatus,
  selectQueuedJobsToStart,
} from "@/lib/workflows/automation-guardrails";
import type { JobRunStartSource } from "@/lib/job-runs";
import type { ReviewFinding } from "@/lib/types";
import type {
  JobContext,
  ReleasedAutomationScope,
} from "@/lib/workflows/automation-job-types";
import type { AutomationModelExecutionMetadata } from "@/lib/workflows/automation-model-execution-types";
import {
  resolveAutomationAiCallUsage,
  resolveAutomationAiCallModel,
} from "@/lib/workflows/automation-job-metadata";
import { normalizeAutomationAssignmentType } from "@/lib/workflows/automation-job-utils";

export async function getDurationMs(startedAt: string) {
  "use step";

  return Date.now() - new Date(startedAt).getTime();
}

export async function persistJobSuccess(input: {
  jobRunId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
}) {
  "use step";

  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .update({
      status: "success",
      completed_at: new Date().toISOString(),
      duration_ms: input.durationMs,
      // job_runs intentionally stores aggregate run totals; rich CapturedUsage
      // fields live on ai_calls, which remains the source for cost rollups.
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      error: null,
    })
    .eq("id", input.jobRunId)
    .neq("status", "cancelled")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to persist successful job run: ${error.message}`);
  }

  return Boolean(data);
}

export async function persistJobFailure(input: {
  jobRunId: string;
  error: string;
  durationMs: number;
}) {
  "use step";

  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      duration_ms: input.durationMs,
      error: input.error,
    })
    .eq("id", input.jobRunId)
    .neq("status", "cancelled")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to persist failed job run: ${error.message}`);
  }

  return Boolean(data);
}

export async function persistJobReviewFindings(input: {
  userId: string;
  jobRunId: string;
  repoId: string | null;
  repoFullName: string | null;
  prNumber: number | null;
  headSha: string | null;
  findings: ReviewFinding[];
}) {
  "use step";

  return replaceJobRunReviewFindings(input);
}

export async function recordStartAttempt(input: {
  jobRunId: string;
  source: JobRunStartSource;
  statusHint?: string | null;
  adminClient?: SupabaseClient;
}) {
  const adminClient = input.adminClient ?? supabaseAdmin;
  const attemptedAt = new Date().toISOString();

  const { data, error } = await adminClient.rpc(
    "record_job_run_start_attempt",
    {
      p_job_run_id: input.jobRunId,
      p_source: input.source,
      p_attempted_at: attemptedAt,
      p_status_hint: input.statusHint ?? null,
    }
  );

  if (error) {
    throw new Error(`Failed to record job start attempt: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    found?: boolean | null;
    attempted_at?: string | null;
  } | null;

  if (!row?.found) {
    return { attemptedAt, notFound: true as const };
  }

  return {
    attemptedAt: row.attempted_at ?? attemptedAt,
    notFound: false as const,
  };
}

export async function recordStartAttemptError(input: {
  jobRunId: string;
  source: JobRunStartSource;
  attemptedAt: string;
  error: string;
  adminClient?: SupabaseClient;
}) {
  const adminClient = input.adminClient ?? supabaseAdmin;
  const { error } = await adminClient
    .from("job_runs")
    .update({
      last_start_attempt_at: input.attemptedAt,
      last_start_source: input.source,
      last_start_error: input.error,
    })
    .eq("id", input.jobRunId);

  if (error) {
    throw new Error(`Failed to persist start attempt error: ${error.message}`);
  }
}

export async function claimPendingJob(input: {
  jobRunId: string;
  repoId: string | null;
  installationId: number | null;
  claimedAt: string;
  adminClient?: SupabaseClient;
}) {
  const adminClient = input.adminClient ?? supabaseAdmin;
  const { data, error } = await adminClient.rpc("claim_automation_job_run", {
    p_job_run_id: input.jobRunId,
    p_repo_id: input.repoId,
    p_installation_id: input.installationId,
    p_claimed_at: input.claimedAt,
    p_max_running_per_installation: AUTOMATION_LIMITS.maxRunningPerInstallation,
  });

  if (error) {
    throw new Error(`Failed to claim job: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    claimed?: boolean;
    status?: string | null;
    reason?: string | null;
    started_at?: string | null;
  } | null;

  return {
    claimed: row?.claimed === true,
    status: row?.status ?? null,
    reason: row?.reason ?? null,
    startedAt: row?.started_at ?? input.claimedAt,
  };
}

export async function resetClaimedJobToPending(
  jobRunId: string,
  adminClient: SupabaseClient = supabaseAdmin
) {
  const { error } = await adminClient
    .from("job_runs")
    .update({
      status: "pending",
      started_at: null,
      completed_at: null,
      duration_ms: null,
      input_tokens: null,
      output_tokens: null,
      error: null,
      runtime_provider: null,
      runtime_run_id: null,
      workflow_run_id: null,
    })
    .eq("id", jobRunId);

  if (error) {
    throw new Error(`Failed to reset claimed job: ${error.message}`);
  }
}

export async function releaseQueuedJobs(
  input: {
    jobRunId: string;
    releasedScope: ReleasedAutomationScope;
  },
  startAutomationJobRun: (
    jobRunId: string,
    source: JobRunStartSource
  ) => Promise<{ started: boolean; reason?: string | null }>
) {
  "use step";

  if (
    !input.releasedScope.repoId &&
    input.releasedScope.installationId == null
  ) {
    return [];
  }

  try {
    const scopes = await loadAutomationScopesByStatus(["pending", "running"]);
    const pendingScopes = scopes.filter(
      (scope) => scope.status === "pending" && scope.jobRunId !== input.jobRunId
    );
    const runningScopes = scopes.filter(
      (scope) => scope.status === "running" && scope.jobRunId !== input.jobRunId
    );

    const nextJobIds = selectQueuedJobsToStart({
      releasedScope: {
        ...input.releasedScope,
        jobRunId: input.jobRunId,
        status: "success",
      },
      pendingScopes,
      runningScopes,
    });

    return await Promise.all(
      nextJobIds.map(async (jobRunId) => {
        try {
          const started = await startAutomationJobRun(
            jobRunId,
            "queue_release"
          );
          return {
            jobRunId,
            started: started.started,
            reason: started.reason ?? null,
          };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to release queued job";
          console.error("[automation-job] failed to release queued job", {
            sourceJobRunId: input.jobRunId,
            jobRunId,
            error: message,
          });
          return {
            jobRunId,
            started: false,
            reason: message,
          };
        }
      })
    );
  } catch (error) {
    console.error("[automation-job] failed to load queued jobs for release", {
      sourceJobRunId: input.jobRunId,
      error: error instanceof Error ? error.message : "Unknown release error",
    });
    return [];
  }
}

export async function tryLogAiCall(input: {
  context: JobContext;
  jobRunId: string;
  status: "success" | "failed";
  startedAt: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error?: string | null;
  toolCalls?: Array<{
    name: string;
    input?: unknown;
    output?: unknown;
    input_preview?: string;
    output_preview?: string;
  }>;
  execution?: AutomationModelExecutionMetadata | null;
}) {
  "use step";

  const { hasCapturedUsage } = await import("@/lib/observability/usage");

  const usage = resolveAutomationAiCallUsage({
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    execution: input.execution,
  });
  const partialFailure = input.status === "failed" && hasCapturedUsage(usage);
  const toolCalls = input.toolCalls || [];
  const model = resolveAutomationAiCallModel(
    input.context.agent.model,
    input.execution
  );
  const { error } = await supabaseAdmin.from("ai_calls").insert({
    user_id: input.context.repo.user_id,
    type: normalizeAutomationAssignmentType(input.context.assignmentType),
    model,
    ...capturedUsageAiCallColumns(usage),
    duration_ms: input.durationMs,
    started_at: input.startedAt,
    completed_at: new Date().toISOString(),
    status: input.status,
    error: input.error || null,
    job_run_id: input.jobRunId,
    repo_id: input.context.repo.id || null,
    tool_calls_count: toolCalls.length,
    tool_calls: toolCalls,
    metadata: {
      ...input.context.metadata,
      ...(input.execution ? { automation_execution: input.execution } : {}),
      ...(partialFailure ? { failed_with_partial_usage: true } : {}),
    },
  });

  return error?.message ?? null;
}

export async function persistAutomationOutcomeMemory(input: {
  context: JobContext;
  jobRunId: string;
  outcome: "completed" | "failed";
  summary: string;
  reason?: string | null;
  execution?: AutomationModelExecutionMetadata | null;
}) {
  "use step";

  const content = input.summary.trim();
  if (!content) return;

  try {
    const { addToLane, buildLaneScopedMetadata, createMemoriesClient } =
      await import("@/lib/memories-client");

    await addToLane(
      createMemoriesClient(input.context.repo.user_id),
      "episodic",
      content,
      buildLaneScopedMetadata(
        "episodic",
        {
          job_run_id: input.jobRunId,
          assignment_type: normalizeAutomationAssignmentType(
            input.context.assignmentType
          ),
          outcome: input.outcome,
          reason: input.reason ?? null,
          agent_id: input.context.agent.id ?? null,
          agent_slug: input.context.agent.slug ?? null,
          ...(input.execution ? { automation_execution: input.execution } : {}),
        },
        {
          repoId: input.context.repo.id,
          source: "automation",
          agent:
            input.context.agent.slug ??
            input.context.agent.name ??
            "automation",
        }
      ),
      { skipEmbedding: true }
    );
  } catch (error) {
    console.warn("[automation-job] failed to persist memory", {
      jobRunId: input.jobRunId,
      repoId: input.context.repo.id,
      error: error instanceof Error ? error.message : error,
    });
  }
}
