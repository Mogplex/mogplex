import { runs } from "@trigger.dev/sdk/v3";
import { logAutomationDispatchEvent } from "@/lib/automation-dispatch";
import {
  appendAiCallEvent,
  requestAiCallCancellationIfActive,
} from "@/lib/interactive-runs";
import {
  getJobRunRuntimeProvider,
  getJobRunRuntimeRunId,
} from "@/lib/job-run-runtime";
import { getJobRunSourceKind, isCancelableJobRun } from "@/lib/job-runs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadAutomationScopeForJobRun,
  loadAutomationScopesByStatus,
  selectQueuedJobsToStart,
} from "@/lib/workflows/automation-guardrails";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-workflow";
import type { AutomationScope } from "@/lib/workflows/automation-guardrails";

type JobRunControlRow = {
  id: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  assignment_id: string | null;
  trigger_id: string | null;
  flow_id: string | null;
  flow_version_id: string | null;
  retry_of_job_run_id: string | null;
  runtime_provider: "trigger" | "workflow" | null;
  runtime_run_id: string | null;
  workflow_run_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancel_error: string | null;
  metadata: Record<string, unknown> | null;
};

type ActiveAiCallRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  repo_id: string | null;
  status: "pending" | "streaming";
  control_state: "active" | "cancel_requested" | "cancelled";
};

const JOB_RUN_CONTROL_SELECT = [
  "id",
  "status",
  "assignment_id",
  "trigger_id",
  "flow_id",
  "flow_version_id",
  "retry_of_job_run_id",
  "runtime_provider",
  "runtime_run_id",
  "workflow_run_id",
  "created_at",
  "started_at",
  "completed_at",
  "duration_ms",
  "error",
  "cancel_requested_at",
  "cancelled_at",
  "cancel_reason",
  "cancel_error",
  "metadata",
].join(", ");

function coerceJobRunControlRow(row: unknown) {
  return row as JobRunControlRow | null;
}

async function loadJobRunControlRow(jobRunId: string) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select(JOB_RUN_CONTROL_SELECT)
    .eq("id", jobRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job run control state: ${error.message}`);
  }

  return coerceJobRunControlRow(data);
}

function getCancelledDurationMs(
  run: Pick<JobRunControlRow, "started_at" | "duration_ms">,
  _cancelledAt: string
) {
  if (run.started_at) {
    return Math.max(0, Date.now() - new Date(run.started_at).getTime());
  }

  return run.duration_ms ?? null;
}

function getJobRunControlFlowVersionId(
  run: Pick<JobRunControlRow, "flow_version_id" | "metadata">
) {
  return typeof run.flow_version_id === "string"
    ? run.flow_version_id
    : typeof run.metadata?.flow_version_id === "string"
      ? run.metadata.flow_version_id
      : null;
}

function getJobRunControlRepoId(run: Pick<JobRunControlRow, "metadata">) {
  return typeof run.metadata?.repo_id === "string"
    ? run.metadata.repo_id
    : null;
}

function getJobRunControlInstallationId(
  run: Pick<JobRunControlRow, "metadata">
) {
  const raw = run.metadata?.installation_id;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getJobRunControlSourceType(
  run: Pick<
    JobRunControlRow,
    | "metadata"
    | "flow_id"
    | "trigger_id"
    | "assignment_id"
    | "retry_of_job_run_id"
  >
) {
  if (
    typeof run.metadata?.source_type === "string" &&
    run.metadata.source_type.length > 0
  ) {
    return run.metadata.source_type;
  }

  const sourceKind = getJobRunSourceKind(run);
  if (sourceKind === "manual_retry") return "manual_retry";
  if (sourceKind === "flow") return "flow";
  if (sourceKind === "trigger") return "trigger";
  return "assignment";
}

// `job_runs` no longer carries a denormalized `user_id`, but control events
// still need a stable owner for automation dispatch logging. Resolve that owner
// from the originating assignment -> repo, trigger, or flow record instead.
async function resolveJobRunControlUserId(
  run: Pick<JobRunControlRow, "assignment_id" | "trigger_id" | "flow_id">
) {
  if (run.assignment_id) {
    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from("assignments")
      .select("id, repo_id")
      .eq("id", run.assignment_id)
      .maybeSingle<{
        id: string;
        repo_id: string;
      }>();

    if (assignmentError) {
      throw new Error(`Failed to load assignment: ${assignmentError.message}`);
    }
    if (!assignment) return null;

    const { data: repo, error: repoError } = await supabaseAdmin
      .from("repos")
      .select("id, user_id")
      .eq("id", assignment.repo_id)
      .maybeSingle<{
        id: string;
        user_id: string;
      }>();

    if (repoError) {
      throw new Error(`Failed to load repo: ${repoError.message}`);
    }

    return repo?.user_id ?? null;
  }

  if (run.trigger_id) {
    const { data: trigger, error: triggerError } = await supabaseAdmin
      .from("triggers")
      .select("id, user_id")
      .eq("id", run.trigger_id)
      .maybeSingle<{
        id: string;
        user_id: string;
      }>();

    if (triggerError) {
      throw new Error(`Failed to load trigger: ${triggerError.message}`);
    }

    return trigger?.user_id ?? null;
  }

  if (!run.flow_id) {
    return null;
  }

  const { data: flow, error: flowError } = await supabaseAdmin
    .from("flows")
    .select("id, user_id")
    .eq("id", run.flow_id)
    .maybeSingle<{
      id: string;
      user_id: string;
    }>();

  if (flowError) {
    throw new Error(`Failed to load flow: ${flowError.message}`);
  }

  return flow?.user_id ?? null;
}

async function resolveJobRunControlUserIdSafely(
  run: Pick<JobRunControlRow, "id" | "assignment_id" | "trigger_id" | "flow_id">
) {
  try {
    const userId = await resolveJobRunControlUserId(run);
    if (!userId) {
      console.warn(
        "[job-run-cancel] skipping control event log without owner",
        {
          jobRunId: run.id,
          assignmentId: run.assignment_id,
          triggerId: run.trigger_id,
          flowId: run.flow_id,
        }
      );
    }
    return userId ?? undefined;
  } catch (error) {
    console.error("[job-run-cancel] failed to resolve control event owner", {
      jobRunId: run.id,
      assignmentId: run.assignment_id,
      triggerId: run.trigger_id,
      flowId: run.flow_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function logJobRunControlEvent(
  run: Pick<
    JobRunControlRow,
    | "id"
    | "assignment_id"
    | "trigger_id"
    | "flow_id"
    | "flow_version_id"
    | "retry_of_job_run_id"
    | "metadata"
  >,
  input: {
    userId?: string;
    outcome: "cancel_requested" | "cancelled" | "cancel_failed" | "reconciled";
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  const userId = input.userId ?? (await resolveJobRunControlUserIdSafely(run));
  if (!userId) {
    return;
  }

  try {
    await logAutomationDispatchEvent({
      userId,
      jobRunId: run.id,
      assignmentId: run.assignment_id,
      triggerId: run.trigger_id,
      flowId: run.flow_id,
      flowVersionId: getJobRunControlFlowVersionId(run),
      repoId: getJobRunControlRepoId(run),
      installationId: getJobRunControlInstallationId(run),
      sourceKind: getJobRunSourceKind(run),
      sourceType: getJobRunControlSourceType(run),
      eventKind: "control",
      outcome: input.outcome,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    console.error("[job-run-cancel] failed to log control event", {
      jobRunId: run.id,
      outcome: input.outcome,
      reason: input.reason ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function setJobRunCancelRequested(input: {
  jobRunId: string;
  cancelRequestedAt: string;
  reason: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .update({
      cancel_requested_at: input.cancelRequestedAt,
      cancel_reason: input.reason,
      cancel_error: null,
    })
    .eq("id", input.jobRunId)
    .in("status", ["pending", "running"])
    .select(JOB_RUN_CONTROL_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to persist job run cancellation request: ${error.message}`
    );
  }

  return coerceJobRunControlRow(data);
}

async function persistJobRunCancelError(input: {
  jobRunId: string;
  cancelRequestedAt: string;
  reason: string;
  cancelError: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .update({
      cancel_requested_at: input.cancelRequestedAt,
      cancel_reason: input.reason,
      cancel_error: input.cancelError,
    })
    .eq("id", input.jobRunId)
    .in("status", ["pending", "running"])
    .select(JOB_RUN_CONTROL_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to persist job run cancel error: ${error.message}`);
  }

  return coerceJobRunControlRow(data);
}

async function finalizeJobRunCancelled(input: {
  jobRunId: string;
  cancelRequestedAt: string;
  cancelledAt: string;
  reason: string;
  cancelError: string | null;
}) {
  const current = await loadJobRunControlRow(input.jobRunId);
  if (!current) {
    return null;
  }

  const completedAt = current.completed_at ?? input.cancelledAt;
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .update({
      status: "cancelled",
      completed_at: completedAt,
      duration_ms: getCancelledDurationMs(current, input.cancelledAt),
      error: null,
      cancel_requested_at:
        current.cancel_requested_at ?? input.cancelRequestedAt,
      cancelled_at: input.cancelledAt,
      cancel_reason: input.reason,
      cancel_error: input.cancelError,
    })
    .eq("id", input.jobRunId)
    .neq("status", "success")
    .neq("status", "failed")
    .select(JOB_RUN_CONTROL_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to finalize job run cancellation: ${error.message}`
    );
  }

  return coerceJobRunControlRow(data) ?? current;
}

async function cancelActiveAiCallsForJobRun(
  jobRunId: string,
  cancelRequestedAt: string
) {
  const { data, error } = await supabaseAdmin
    .from("ai_calls")
    .select("id, user_id, conversation_id, repo_id, status, control_state")
    .eq("job_run_id", jobRunId)
    .in("status", ["pending", "streaming"]);

  if (error) {
    throw new Error(
      `Failed to load active AI calls for cancellation: ${error.message}`
    );
  }

  const calls = (data || []) as ActiveAiCallRow[];
  const results = await Promise.all(
    calls.map(async (call) => {
      const next = await requestAiCallCancellationIfActive(
        call.id,
        cancelRequestedAt
      );
      if (next && call.control_state === "active") {
        await appendAiCallEvent({
          aiCallId: call.id,
          userId: call.user_id,
          conversationId: call.conversation_id,
          repoId: call.repo_id,
          eventType: "cancel_requested",
          message: "Parent job run cancellation requested",
          payload: {
            job_run_id: jobRunId,
          },
        });
      }
      return next;
    })
  );

  return {
    total: calls.length,
    requested: results.filter(Boolean).length,
  };
}

async function cancelRunningFlowNodeRuns(
  jobRunId: string,
  reason: string,
  cancelledAt: string
) {
  const { data, error } = await supabaseAdmin
    .from("flow_node_runs")
    .select("id, started_at")
    .eq("job_run_id", jobRunId)
    .eq("status", "running");

  if (error) {
    throw new Error(`Failed to load running flow node runs: ${error.message}`);
  }

  const nodeRuns = (data || []) as Array<{
    id: string;
    started_at: string | null;
  }>;
  await Promise.all(
    nodeRuns.map(async (nodeRun) => {
      const durationMs = nodeRun.started_at
        ? Math.max(
            0,
            new Date(cancelledAt).getTime() -
              new Date(nodeRun.started_at).getTime()
          )
        : null;

      const { error: updateError } = await supabaseAdmin
        .from("flow_node_runs")
        .update({
          status: "cancelled",
          completed_at: cancelledAt,
          duration_ms: durationMs,
          error: reason,
          output: {
            cancelled: true,
            reason,
          },
        })
        .eq("id", nodeRun.id)
        .eq("status", "running");

      if (updateError) {
        throw new Error(
          `Failed to cancel flow node run ${nodeRun.id}: ${updateError.message}`
        );
      }
    })
  );

  return nodeRuns.length;
}

async function releaseQueuedJobsAfterTerminalRun(jobRunId: string) {
  const releasedScope = await loadAutomationScopeForJobRun(jobRunId);
  if (!releasedScope?.repoId && releasedScope?.installationId == null) {
    return [];
  }

  const scopes = await loadAutomationScopesByStatus(["pending", "running"]);
  const pendingScopes = scopes.filter(
    (scope) => scope.status === "pending" && scope.jobRunId !== jobRunId
  );
  const runningScopes = scopes.filter(
    (scope) => scope.status === "running" && scope.jobRunId !== jobRunId
  );

  const nextJobIds = selectQueuedJobsToStart({
    releasedScope: {
      ...(releasedScope as AutomationScope),
      jobRunId,
      status: "cancelled",
    },
    pendingScopes,
    runningScopes,
  });

  return Promise.all(
    nextJobIds.map(async (nextJobRunId) => {
      try {
        const started = await startAutomationJobRun(
          nextJobRunId,
          "queue_release"
        );
        return {
          jobRunId: nextJobRunId,
          started: started.started,
          reason: started.reason ?? null,
        };
      } catch (error) {
        return {
          jobRunId: nextJobRunId,
          started: false,
          reason:
            error instanceof Error
              ? error.message
              : "Failed to start released queued job",
        };
      }
    })
  );
}

async function cancelPendingFlowWaits(jobRunId: string, cancelledAt: string) {
  const { error } = await supabaseAdmin
    .from("flow_waits")
    .update({
      status: "cancelled",
      resumed_at: null,
      resume_payload: {
        cancelled: true,
        cancelled_at: cancelledAt,
      },
      resume_delivery_id: null,
    })
    .eq("job_run_id", jobRunId)
    .eq("status", "waiting");

  if (error) {
    throw new Error(`Failed to cancel pending flow waits: ${error.message}`);
  }
}

export type CancelAutomationJobRunResult =
  | {
      ok: false;
      notFound: true;
    }
  | {
      ok: false;
      notFound: false;
      status: JobRunControlRow["status"];
      cancelable: boolean;
      cancelRequestedAt: string | null;
      cancelledAt: string | null;
      cancelReason: string | null;
      cancelError: string | null;
    }
  | {
      ok: true;
      status: "cancelled";
      cancelRequestedAt: string;
      cancelledAt: string;
      cancelReason: string;
      cancelError: string | null;
      runtimeProvider: JobRunControlRow["runtime_provider"];
      runtimeRunId: string | null;
      aiCallsCancellationRequested: number;
      releasedJobs: Array<{
        jobRunId: string;
        started: boolean;
        reason: string | null;
      }>;
    };

function canFinalizeCancelledStatus(status: JobRunControlRow["status"]) {
  return status === "pending" || status === "running";
}

export async function cancelAutomationJobRun(
  jobRunId: string,
  reason = "USER_REQUESTED"
): Promise<CancelAutomationJobRunResult> {
  const current = await loadJobRunControlRow(jobRunId);

  if (!current) {
    return { ok: false, notFound: true };
  }

  if (!canFinalizeCancelledStatus(current.status)) {
    return {
      ok: false,
      notFound: false,
      status: current.status,
      cancelable: isCancelableJobRun(current),
      cancelRequestedAt: current.cancel_requested_at,
      cancelledAt: current.cancelled_at,
      cancelReason: current.cancel_reason,
      cancelError: current.cancel_error,
    };
  }

  const ownerUserId = await resolveJobRunControlUserIdSafely(current);

  const cancelRequestedAt =
    current.cancel_requested_at ?? new Date().toISOString();
  const requested = await setJobRunCancelRequested({
    jobRunId,
    cancelRequestedAt,
    reason,
  });

  if (!requested) {
    const latest = await loadJobRunControlRow(jobRunId);
    if (!latest) {
      return { ok: false, notFound: true };
    }

    return {
      ok: false,
      notFound: false,
      status: latest.status,
      cancelable: isCancelableJobRun(latest),
      cancelRequestedAt: latest.cancel_requested_at,
      cancelledAt: latest.cancelled_at,
      cancelReason: latest.cancel_reason,
      cancelError: latest.cancel_error,
    };
  }

  if (!current.cancel_requested_at) {
    await logJobRunControlEvent(requested, {
      userId: ownerUserId,
      outcome: "cancel_requested",
      reason,
      metadata: {
        cancel_requested_at: requested.cancel_requested_at ?? cancelRequestedAt,
        runtime_provider: getJobRunRuntimeProvider(requested),
        runtime_run_id: getJobRunRuntimeRunId(requested),
      },
    });
  }

  const runtimeProvider = getJobRunRuntimeProvider(requested);
  const runtimeRunId = getJobRunRuntimeRunId(requested);
  const aiCallsCancellationRequested = await (async () => {
    try {
      const aiCallSummary = await cancelActiveAiCallsForJobRun(
        jobRunId,
        cancelRequestedAt
      );

      if (runtimeProvider === "trigger" && runtimeRunId) {
        await runs.cancel(runtimeRunId);
      } else if (runtimeRunId) {
        throw new Error(
          `Cancellation is not implemented for runtime provider "${runtimeProvider || "unknown"}"`
        );
      }

      return aiCallSummary.requested;
    } catch (error) {
      const cancelError =
        error instanceof Error
          ? error.message
          : "Failed to propagate run cancellation";
      const failed = await persistJobRunCancelError({
        jobRunId,
        cancelRequestedAt,
        reason,
        cancelError,
      });
      if (failed) {
        await logJobRunControlEvent(failed, {
          userId: ownerUserId ?? undefined,
          outcome: "cancel_failed",
          reason: cancelError,
          metadata: {
            cancel_requested_at:
              failed.cancel_requested_at ?? cancelRequestedAt,
            cancel_reason: failed.cancel_reason ?? reason,
            cancel_error: cancelError,
            runtime_provider: runtimeProvider,
            runtime_run_id: runtimeRunId,
          },
        });
      }
      throw new Error(cancelError, { cause: error });
    }
  })();

  const cancelledAt = new Date().toISOString();
  let final: JobRunControlRow | null;

  try {
    await cancelPendingFlowWaits(jobRunId, cancelledAt);
    await cancelRunningFlowNodeRuns(jobRunId, reason, cancelledAt);
    final = await finalizeJobRunCancelled({
      jobRunId,
      cancelRequestedAt,
      cancelledAt,
      reason,
      cancelError: null,
    });
  } catch (error) {
    const cancelError =
      error instanceof Error
        ? error.message
        : "Failed to finalize cancelled job run";
    const failed = await persistJobRunCancelError({
      jobRunId,
      cancelRequestedAt,
      reason,
      cancelError,
    });
    if (failed) {
      await logJobRunControlEvent(failed, {
        userId: ownerUserId ?? undefined,
        outcome: "cancel_failed",
        reason: cancelError,
        metadata: {
          cancel_requested_at: failed.cancel_requested_at ?? cancelRequestedAt,
          cancel_reason: failed.cancel_reason ?? reason,
          cancel_error: cancelError,
          runtime_provider: runtimeProvider,
          runtime_run_id: runtimeRunId,
        },
      });
    }
    throw new Error(cancelError, { cause: error });
  }

  if (!final) {
    return { ok: false, notFound: true };
  }

  if (final.status !== "cancelled") {
    return {
      ok: false,
      notFound: false,
      status: final.status,
      cancelable: isCancelableJobRun(final),
      cancelRequestedAt: final.cancel_requested_at,
      cancelledAt: final.cancelled_at,
      cancelReason: final.cancel_reason,
      cancelError: final.cancel_error,
    };
  }

  await logJobRunControlEvent(final, {
    userId: ownerUserId ?? undefined,
    outcome: "cancelled",
    reason: final.cancel_reason ?? reason,
    metadata: {
      cancel_requested_at: final.cancel_requested_at ?? cancelRequestedAt,
      cancelled_at: final.cancelled_at ?? cancelledAt,
      ai_calls_cancellation_requested: aiCallsCancellationRequested,
      runtime_provider: runtimeProvider,
      runtime_run_id: runtimeRunId,
    },
  });

  const releasedJobs = await releaseQueuedJobsAfterTerminalRun(jobRunId);

  return {
    ok: true,
    status: "cancelled",
    cancelRequestedAt: final.cancel_requested_at ?? cancelRequestedAt,
    cancelledAt: final.cancelled_at ?? cancelledAt,
    cancelReason: final.cancel_reason ?? reason,
    cancelError: null,
    runtimeProvider: getJobRunRuntimeProvider(final),
    runtimeRunId: getJobRunRuntimeRunId(final),
    aiCallsCancellationRequested,
    releasedJobs,
  };
}

type ReconcileJobRunResult = {
  jobRunId: string;
  outcome: "cancelled" | "failed" | "skipped";
  reason: string | null;
};

export async function reconcileAutomationJobRuns(limit = 100) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select(JOB_RUN_CONTROL_SELECT)
    .or(
      "and(cancel_requested_at.not.is.null,cancelled_at.is.null),and(status.eq.running,runtime_provider.eq.trigger,runtime_run_id.is.null,workflow_run_id.is.null)"
    )
    .order("cancel_requested_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw new Error(
      `Failed to load reconciliation candidates: ${error.message}`
    );
  }

  const candidates = (data || []) as unknown as JobRunControlRow[];
  const results: ReconcileJobRunResult[] = [];

  for (const candidate of candidates) {
    if (candidate.cancel_requested_at && !candidate.cancelled_at) {
      const result = await cancelAutomationJobRun(
        candidate.id,
        candidate.cancel_reason || "RECONCILED_CANCEL_REQUEST"
      );
      if (result.ok) {
        const current = await loadJobRunControlRow(candidate.id);
        if (current) {
          const currentUserId = await resolveJobRunControlUserIdSafely(current);
          await logJobRunControlEvent(current, {
            userId: currentUserId ?? undefined,
            outcome: "reconciled",
            reason: "RECONCILED_CANCEL_REQUEST",
            metadata: {
              reconciled_outcome: "cancelled",
              cancel_requested_at: current.cancel_requested_at,
              cancelled_at: current.cancelled_at,
            },
          });
        }
      }
      results.push({
        jobRunId: candidate.id,
        outcome: result.ok ? "cancelled" : "skipped",
        reason: result.ok
          ? result.cancelError
          : result.notFound
            ? "JOB_NOT_FOUND"
            : (result.cancelError ?? result.cancelReason ?? result.status),
      });
      continue;
    }

    if (
      candidate.status === "running" &&
      getJobRunRuntimeProvider(candidate) === "trigger" &&
      !getJobRunRuntimeRunId(candidate)
    ) {
      const { count, error: activeCallsError } = await supabaseAdmin
        .from("ai_calls")
        .select("*", { count: "exact", head: true })
        .eq("job_run_id", candidate.id)
        .in("status", ["pending", "streaming"]);

      if (activeCallsError) {
        throw new Error(
          `Failed to load active child calls for reconciliation: ${activeCallsError.message}`
        );
      }

      if ((count || 0) > 0) {
        results.push({
          jobRunId: candidate.id,
          outcome: "skipped",
          reason: "ACTIVE_AI_CALLS_STILL_RUNNING",
        });
        continue;
      }

      const reconciledAt = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from("job_runs")
        .update({
          status: "failed",
          completed_at: reconciledAt,
          error: "RECONCILED_MISSING_RUNTIME_HANDLE",
          cancel_error: null,
        })
        .eq("id", candidate.id)
        .eq("status", "running");

      if (updateError) {
        throw new Error(
          `Failed to reconcile missing runtime handle: ${updateError.message}`
        );
      }

      const candidateUserId = await resolveJobRunControlUserIdSafely(candidate);
      await logJobRunControlEvent(candidate, {
        userId: candidateUserId ?? undefined,
        outcome: "reconciled",
        reason: "RECONCILED_MISSING_RUNTIME_HANDLE",
        metadata: {
          reconciled_outcome: "failed",
          completed_at: reconciledAt,
        },
      });

      await releaseQueuedJobsAfterTerminalRun(candidate.id);
      results.push({
        jobRunId: candidate.id,
        outcome: "failed",
        reason: "RECONCILED_MISSING_RUNTIME_HANDLE",
      });
    }
  }

  return results;
}
