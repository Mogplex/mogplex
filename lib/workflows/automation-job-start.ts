/**
 * Job starting functions for the automation job workflow.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import { runs, tasks } from "@trigger.dev/sdk/v3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  ACCOUNT_CONCURRENCY_LIMIT,
  admitAutomationJobCapacity,
} from "@/lib/billing/workflow-capacity";
import {
  describeStartGuardReason,
  loadAutomationScopeForJobRun,
} from "@/lib/workflows/automation-guardrails";
import type { StartGuardReason } from "@/lib/workflows/automation-guardrails";
import type { JobRunStartSource } from "@/lib/job-runs";
import {
  AUTOMATION_JOB_TRIGGER_MAX_ATTEMPTS,
  JOB_RUN_CANCELLED,
  RUNTIME_HANDLE_PERSIST_FAILED,
  type AutomationJobInput,
  type ReleasedAutomationScope,
  type StartDispatchContext,
  type StartedAutomationJob,
} from "@/lib/workflows/automation-job-types";
import {
  claimPendingJob,
  recordStartAttempt,
  recordStartAttemptError,
  rollbackClaimedJobStart,
} from "@/lib/workflows/automation-job-persistence";
import {
  loadStartDispatchContext,
  recordStartDispatchEvent,
} from "@/lib/workflows/automation-job-dispatch";

async function startTriggerAutomationRun(
  input: AutomationJobInput,
  startSource: JobRunStartSource
) {
  if (!isTriggerRuntimeConfigured()) {
    throw new Error("Trigger.dev runtime is not configured");
  }

  const handle = await tasks.trigger(TRIGGER_TASK_IDS.automationJob, input, {
    idempotencyKey: [
      "automation-job",
      input.jobRunId,
      startSource,
      input.startedAt,
    ].join(":"),
    concurrencyKey: input.releasedScope.repoId
      ? `repo:${input.releasedScope.repoId}`
      : input.releasedScope.installationId == null
        ? undefined
        : `installation:${input.releasedScope.installationId}`,
    maxAttempts: AUTOMATION_JOB_TRIGGER_MAX_ATTEMPTS,
    tags: [
      `jobRun:${input.jobRunId}`,
      `source:${input.releasedScope.sourceType}`,
      ...(input.releasedScope.repoId
        ? [`repo:${input.releasedScope.repoId}`]
        : []),
    ],
    metadata: {
      jobRunId: input.jobRunId,
      sourceType: input.releasedScope.sourceType,
      sourceKind: input.releasedScope.sourceKind,
      repoId: input.releasedScope.repoId,
      installationId: input.releasedScope.installationId,
      billingAccountId: input.billingAccountId,
      startSource,
    },
  });

  return {
    provider: "trigger" as const,
    runtimeRunId: handle.id,
  };
}

export async function startAutomationJobRun(
  jobRunId: string,
  source: JobRunStartSource = "webhook",
  adminClient: SupabaseClient = supabaseAdmin
): Promise<StartedAutomationJob> {
  const { data: job, error } = await adminClient
    .from("job_runs")
    .select(
      "id, status, runtime_provider, runtime_run_id, workflow_run_id, cancel_requested_at, cancelled_at"
    )
    .eq("id", jobRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job run: ${error.message}`);
  }

  if (!job) {
    return { started: false, notFound: true, status: null };
  }

  if (
    job.status === "cancelled" ||
    job.cancel_requested_at ||
    job.cancelled_at
  ) {
    return {
      started: false,
      status: "cancelled",
      runtimeProvider: job.runtime_provider ?? undefined,
      runtimeRunId: job.runtime_run_id ?? job.workflow_run_id ?? undefined,
      workflowRunId: job.workflow_run_id ?? undefined,
      reason: JOB_RUN_CANCELLED,
    };
  }

  const attempt = await recordStartAttempt({
    jobRunId,
    source,
    statusHint: job.status,
    adminClient,
  });

  if (attempt.notFound) {
    return { started: false, notFound: true, status: null };
  }

  if (job.status !== "pending") {
    return {
      started: false,
      status: job.status,
      runtimeProvider: job.runtime_provider ?? undefined,
      runtimeRunId: job.runtime_run_id ?? job.workflow_run_id ?? undefined,
      workflowRunId: job.workflow_run_id ?? undefined,
    };
  }

  let dispatchContext: StartDispatchContext | null = null;
  let releasedScope: ReleasedAutomationScope = {
    sourceKind: "assignment",
    sourceType: "unknown",
    sourceId: null,
    repoId: null,
    installationId: null,
  };
  let claim: Awaited<ReturnType<typeof claimPendingJob>>;

  try {
    dispatchContext = await loadStartDispatchContext(jobRunId, adminClient);

    const scope = await loadAutomationScopeForJobRun(jobRunId, adminClient);
    releasedScope = scope
      ? {
          sourceKind: scope.sourceKind,
          sourceType: scope.sourceType,
          sourceId: scope.sourceId,
          repoId: scope.repoId,
          installationId: scope.installationId,
        }
      : releasedScope;

    claim = await claimPendingJob({
      jobRunId,
      repoId: releasedScope.repoId,
      installationId: releasedScope.installationId,
      claimedAt: attempt.attemptedAt,
      adminClient,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to prepare job start";
    await recordStartAttemptError({
      jobRunId,
      source,
      attemptedAt: attempt.attemptedAt,
      error: message,
      adminClient,
    });
    await recordStartDispatchEvent({
      context: dispatchContext,
      jobRunId,
      outcome: "start_failed",
      reason: message,
      source,
      adminClient,
    });
    throw error;
  }

  if (!claim.claimed) {
    if (claim.reason === "JOB_NOT_FOUND") {
      return {
        started: false,
        notFound: true,
        status: null,
        reason: claim.reason,
      };
    }

    if (claim.reason) {
      await recordStartAttemptError({
        jobRunId,
        source,
        attemptedAt: attempt.attemptedAt,
        error: describeStartGuardReason(claim.reason as StartGuardReason),
        adminClient,
      });
      await recordStartDispatchEvent({
        context: dispatchContext,
        jobRunId,
        outcome: "deferred",
        reason: claim.reason,
        source,
        adminClient,
      });
      return {
        started: false,
        deferred: true,
        status: claim.status ?? "pending",
        reason: claim.reason,
      };
    }

    return {
      started: false,
      status: claim.status,
      runtimeProvider: job.runtime_provider ?? undefined,
      runtimeRunId: job.runtime_run_id ?? job.workflow_run_id ?? undefined,
      workflowRunId: job.workflow_run_id ?? undefined,
    };
  }

  let capacity: Awaited<ReturnType<typeof admitAutomationJobCapacity>>;
  try {
    capacity = await admitAutomationJobCapacity(
      {
        jobRunId,
        source,
        attemptedAt: attempt.attemptedAt,
        context: dispatchContext,
      },
      adminClient
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to record workflow capacity admission";
    await rollbackClaimedJobStart(jobRunId, adminClient, {
      sourceRef: `capacity-admission-failed:${jobRunId}:${attempt.attemptedAt}`,
      rolledBackAt: attempt.attemptedAt,
      metadata: { reason: "capacity_admission_failed" },
    });
    await recordStartAttemptError({
      jobRunId,
      source,
      attemptedAt: attempt.attemptedAt,
      error: message,
      adminClient,
    });
    await recordStartDispatchEvent({
      context: dispatchContext,
      jobRunId,
      outcome: "start_failed",
      reason: message,
      source,
      adminClient,
    });
    throw error;
  }

  if (!capacity.admitted) {
    const rollback = await rollbackClaimedJobStart(jobRunId, adminClient, {
      sourceRef: `capacity-deferred:${jobRunId}:${attempt.attemptedAt}`,
      rolledBackAt: attempt.attemptedAt,
      metadata: { reason: ACCOUNT_CONCURRENCY_LIMIT },
    });
    await recordStartAttemptError({
      jobRunId,
      source,
      attemptedAt: attempt.attemptedAt,
      error: describeStartGuardReason(ACCOUNT_CONCURRENCY_LIMIT),
      adminClient,
    });
    await recordStartDispatchEvent({
      context: dispatchContext,
      jobRunId,
      outcome: "deferred",
      reason: ACCOUNT_CONCURRENCY_LIMIT,
      source,
      metadata: {
        billing_account_id: capacity.accountId,
        active_concurrency: capacity.activeBefore,
        concurrency_limit: capacity.concurrencyLimit,
      },
      adminClient,
    });
    return {
      started: false,
      deferred: true,
      status: rollback.jobStatus ?? "pending",
      reason: ACCOUNT_CONCURRENCY_LIMIT,
    };
  }

  let startedRun: Awaited<ReturnType<typeof startTriggerAutomationRun>>;
  try {
    startedRun = await startTriggerAutomationRun(
      {
        jobRunId,
        startedAt: claim.startedAt,
        releasedScope,
        billingAccountId: capacity.accountId,
      },
      source
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start background runtime";
    await rollbackClaimedJobStart(jobRunId, adminClient, {
      sourceRef: `runtime-start-failed:${jobRunId}:${attempt.attemptedAt}`,
      rolledBackAt: new Date().toISOString(),
      metadata: { reason: "runtime_start_failed" },
    });
    await recordStartAttemptError({
      jobRunId,
      source,
      attemptedAt: attempt.attemptedAt,
      error: message,
      adminClient,
    });
    await recordStartDispatchEvent({
      context: dispatchContext,
      jobRunId,
      outcome: "start_failed",
      reason: message,
      source,
      adminClient,
    });
    throw error;
  }

  const { runtimeRunId } = startedRun;
  const { error: updateError } = await adminClient
    .from("job_runs")
    .update({
      runtime_provider: startedRun.provider,
      runtime_run_id: runtimeRunId ?? null,
      workflow_run_id: null,
      last_start_source: source,
      last_start_error: null,
    })
    .eq("id", jobRunId);

  if (updateError) {
    console.error(
      "[automation-job] failed to persist background runtime run id",
      {
        jobRunId,
        runtimeProvider: startedRun.provider,
        runtimeRunId,
        error: updateError.message,
      }
    );

    let cancelErrorMessage: string | null = null;

    if (runtimeRunId) {
      try {
        await runs.cancel(runtimeRunId);
      } catch (cancelError) {
        cancelErrorMessage =
          cancelError instanceof Error
            ? cancelError.message
            : "Unknown cancel error";
        console.error(
          "[automation-job] failed to cancel trigger run after persistence failure",
          {
            jobRunId,
            runtimeRunId,
            error: cancelErrorMessage,
          }
        );
      }
    }

    let rollbackJobStatus: string | null = null;
    if (!cancelErrorMessage) {
      const rollback = await rollbackClaimedJobStart(jobRunId, adminClient, {
        sourceRef: `runtime-handle-rollback:${jobRunId}:${attempt.attemptedAt}`,
        rolledBackAt: new Date().toISOString(),
        metadata: { reason: RUNTIME_HANDLE_PERSIST_FAILED },
      });
      rollbackJobStatus = rollback.jobStatus;
    }

    const startError = cancelErrorMessage
      ? `${RUNTIME_HANDLE_PERSIST_FAILED} (cancel rollback failed: ${cancelErrorMessage})`
      : RUNTIME_HANDLE_PERSIST_FAILED;

    await recordStartAttemptError({
      jobRunId,
      source,
      attemptedAt: attempt.attemptedAt,
      error: startError,
      adminClient,
    });
    await recordStartDispatchEvent({
      context: dispatchContext,
      jobRunId,
      outcome: "start_failed",
      reason: RUNTIME_HANDLE_PERSIST_FAILED,
      source,
      metadata: {
        runtime_provider: startedRun.provider,
        runtime_run_id: runtimeRunId ?? null,
        persist_error: updateError.message,
        cancel_error: cancelErrorMessage,
      },
      adminClient,
    });

    return {
      started: false,
      status: cancelErrorMessage ? "running" : (rollbackJobStatus ?? "pending"),
      reason: RUNTIME_HANDLE_PERSIST_FAILED,
    };
  }

  await recordStartDispatchEvent({
    context: dispatchContext,
    jobRunId,
    outcome: "started",
    source,
    metadata: capacity.tracked
      ? {
          billing_account_id: capacity.accountId,
          capacity_accounting_mode: capacity.accountingMode,
          capacity_would_admit: capacity.wouldAdmit,
          active_concurrency_before: capacity.activeBefore,
          concurrency_limit: capacity.concurrencyLimit,
        }
      : { capacity_tracking: "unresolved_scope" },
    adminClient,
  });

  return {
    started: true,
    status: "running",
    runtimeProvider: startedRun.provider,
    runtimeRunId,
  };
}

export function serializeAutomationJobStart(started: StartedAutomationJob) {
  return {
    started: started.started,
    deferred: started.deferred ?? false,
    reason: started.reason ?? null,
    status: started.status ?? null,
    runtimeProvider: started.runtimeProvider ?? null,
    runtimeRunId: started.runtimeRunId ?? started.workflowRunId ?? null,
    workflowRunId: started.workflowRunId ?? null,
  };
}
