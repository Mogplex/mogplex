import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { isMogplexPrReviewRerunEvent } from "@/lib/github-check-runs";
import {
  enqueueJobRunRetry,
  getDefaultJobRunRetryVersionMode,
  isJobRunRetryVersionError,
  loadJobRunRetryContext,
} from "@/lib/job-run-retry";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-workflow";
import type {
  CheckRunRetryContextMatchInput,
  StartedWebhookJob,
  WebhookCheckRunBody,
  WebhookRepoRow,
  WebhookRequestContext,
  WebhookRequestedAction,
  WebhookSyncResult,
} from "./types";

function buildWebhookJobIdempotencyKey(
  scope: string,
  payload: string,
  deliveryId: string | null
) {
  const source =
    deliveryId || crypto.createHash("sha256").update(payload).digest("hex");
  return `github-webhook:${scope}:${source}`;
}

export function isPrReviewCheckRunRetryRequest(body: Record<string, unknown>) {
  const checkRun = body.check_run as WebhookCheckRunBody | undefined;
  const requestedAction = body.requested_action as
    | WebhookRequestedAction
    | undefined;

  return isMogplexPrReviewRerunEvent({
    action: typeof body.action === "string" ? body.action : null,
    checkRunName: typeof checkRun?.name === "string" ? checkRun.name : null,
    requestedActionIdentifier:
      typeof requestedAction?.identifier === "string"
        ? requestedAction.identifier
        : null,
  });
}

export function doesCheckRunRetryContextMatchWebhookRepo(
  input: CheckRunRetryContextMatchInput
) {
  if (input.repoId) {
    return input.repoRows.some((repo) => repo.id === input.repoId);
  }

  return (
    input.installationId !== null &&
    input.webhookInstallationId !== null &&
    input.installationId === input.webhookInstallationId
  );
}

export async function startWebhookJobRun(
  jobRunId: string,
  source: "webhook" | "manual_retry",
  startJobRun: typeof startAutomationJobRun = startAutomationJobRun
): Promise<StartedWebhookJob> {
  try {
    const started = await startJobRun(jobRunId, source);
    return {
      started: started.started,
      deferred: started.deferred ?? false,
      runtimeProvider: started.runtimeProvider ?? null,
      runtimeRunId: started.runtimeRunId ?? started.workflowRunId ?? null,
      workflowRunId: started.workflowRunId ?? null,
      status: started.status ?? null,
      reason: started.reason ?? null,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start automation run";
    console.error("Failed to start automation run:", {
      jobId: jobRunId,
      error: message,
      source,
    });
    return {
      started: false,
      deferred: false,
      runtimeProvider: null,
      runtimeRunId: null,
      workflowRunId: null,
      status: "pending",
      reason: null,
      error: message,
    };
  }
}

type CheckRunRetryResponseDeps = {
  loadJobRunRetryContext: typeof loadJobRunRetryContext;
  enqueueJobRunRetry: typeof enqueueJobRunRetry;
  startWebhookJobRun: typeof startWebhookJobRun;
};

const defaultCheckRunRetryResponseDeps: CheckRunRetryResponseDeps = {
  loadJobRunRetryContext,
  enqueueJobRunRetry,
  startWebhookJobRun,
};

export async function buildCheckRunRetryResponse(
  input: {
    context: WebhookRequestContext;
    repoRows: WebhookRepoRow[];
    sync: WebhookSyncResult;
  },
  overrides: Partial<CheckRunRetryResponseDeps> = {}
) {
  const deps = { ...defaultCheckRunRetryResponseDeps, ...overrides };
  if (input.context.event !== "check_run") return null;
  if (!isPrReviewCheckRunRetryRequest(input.context.body)) return null;

  const checkRun = input.context.body.check_run as WebhookCheckRunBody;
  const externalJobRunId =
    typeof checkRun?.external_id === "string"
      ? checkRun.external_id.trim()
      : "";

  if (!externalJobRunId) {
    return NextResponse.json({
      ok: true,
      queued: false,
      suppressed: true,
      reason: "MISSING_CHECK_RUN_EXTERNAL_ID",
      sync: input.sync,
    });
  }

  const retryContext = await deps.loadJobRunRetryContext(externalJobRunId);
  if (!retryContext) {
    return NextResponse.json({
      ok: true,
      queued: false,
      suppressed: true,
      reason: "RETRY_CONTEXT_NOT_FOUND",
      sync: input.sync,
    });
  }

  if (
    !doesCheckRunRetryContextMatchWebhookRepo({
      repoRows: input.repoRows,
      repoId: retryContext.repoId,
      installationId: retryContext.installationId,
      webhookInstallationId: input.context.installationId,
    })
  ) {
    return NextResponse.json(
      { error: "Job run does not belong to this repository" },
      { status: 404 }
    );
  }

  const idempotencyKey = buildWebhookJobIdempotencyKey(
    `check-run-rerun:${checkRun.id ?? externalJobRunId}`,
    input.context.payload,
    input.context.deliveryId
  );
  const requestedVersionMode = getDefaultJobRunRetryVersionMode(retryContext);
  const metadataPatch = {
    review_check_run_id: typeof checkRun.id === "number" ? checkRun.id : null,
    review_check_run_rerun_requested: true,
    review_check_run_external_job_run_id: externalJobRunId,
    review_check_run_delivery_id: input.context.deliveryId,
  };
  let versionFallbackUsed = false;
  let enqueueResult: Awaited<ReturnType<typeof enqueueJobRunRetry>>;

  try {
    enqueueResult = await deps.enqueueJobRunRetry({
      retryContext,
      idempotencyKeyPrefix: `github-check-run-rerun:${checkRun.id ?? "unknown"}`,
      idempotencyKey,
      versionMode: requestedVersionMode,
      metadataPatch,
    });
  } catch (error) {
    if (
      !isJobRunRetryVersionError(error) ||
      requestedVersionMode !== "latest_published"
    ) {
      throw error;
    }

    // A deleted/unpublished current flow should not turn a signed GitHub
    // requested_action into a 500/redelivery loop. Replaying the immutable
    // version from the original run preserves the old retry behavior.
    versionFallbackUsed = true;
    enqueueResult = await deps.enqueueJobRunRetry({
      retryContext,
      idempotencyKeyPrefix: `github-check-run-rerun:${checkRun.id ?? "unknown"}`,
      idempotencyKey,
      versionMode: "same_version",
      metadataPatch: {
        ...metadataPatch,
        retry_latest_published_unavailable: true,
      },
    });
  }

  const reusedIdempotentJob =
    enqueueResult.outcome === "suppressed" &&
    enqueueResult.reason === "IDEMPOTENT_DUPLICATE" &&
    Boolean(enqueueResult.jobRunId);

  if (
    !enqueueResult.jobRunId ||
    (enqueueResult.outcome !== "queued" && !reusedIdempotentJob)
  ) {
    return NextResponse.json({
      ok: true,
      queued: false,
      suppressed: true,
      reason: enqueueResult.reason,
      jobRunId: null,
      started: false,
      deferred: false,
      runtimeProvider: null,
      runtimeRunId: null,
      workflowRunId: null,
      status: "pending",
      versionFallbackUsed,
      sync: input.sync,
    });
  }

  // Redelivery may be the only chance to start a job if the first request
  // committed the enqueue and then failed before dispatch. startAutomationJobRun
  // claims pending jobs atomically and is safe for already-running/completed IDs.
  const started = await deps.startWebhookJobRun(
    enqueueResult.jobRunId,
    "manual_retry"
  );

  return NextResponse.json({
    ok: true,
    queued: enqueueResult.outcome === "queued",
    suppressed: reusedIdempotentJob,
    reused: reusedIdempotentJob,
    jobRunId: enqueueResult.jobRunId,
    error: started.error,
    sync: input.sync,
    started: started.started,
    deferred: started.deferred,
    reason: started.reason ?? enqueueResult.reason,
    status: started.status,
    runtimeProvider: started.runtimeProvider,
    runtimeRunId: started.runtimeRunId,
    workflowRunId: started.workflowRunId,
    versionFallbackUsed,
  });
}
