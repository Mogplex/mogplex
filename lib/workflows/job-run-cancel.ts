import { runs } from "@trigger.dev/sdk/v3";
import {
  getJobRunRuntimeProvider,
  getJobRunRuntimeRunId,
} from "@/lib/job-run-runtime";
import { isCancelableJobRun } from "@/lib/job-runs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  CancelAutomationJobRunResult,
  JobRunControlRow,
  ReconcileJobRunResult,
} from "./job-run-cancel-types";
import { JOB_RUN_CONTROL_SELECT } from "./job-run-cancel-types";
import { canFinalizeCancelledStatus } from "./job-run-cancel-helpers";
import {
  loadJobRunControlRow,
  setJobRunCancelRequested,
  persistJobRunCancelError,
  finalizeJobRunCancelled,
} from "./job-run-cancel-persistence";
import {
  resolveJobRunControlUserIdSafely,
  logJobRunControlEvent,
} from "./job-run-cancel-logging";
import {
  cancelActiveAiCallsForJobRun,
  cancelRunningFlowNodeRuns,
  cancelPendingFlowWaits,
  releaseQueuedJobsAfterTerminalRun,
} from "./job-run-cancel-child-ops";

// Re-export public types
export type { CancelAutomationJobRunResult } from "./job-run-cancel-types";

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
