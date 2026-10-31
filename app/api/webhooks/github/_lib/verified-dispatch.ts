import { AbortTaskRunError } from "@trigger.dev/sdk";
import {
  DatabaseSchemaError,
  isSchemaDriftError,
  SCHEMA_DRIFT_CODE,
} from "@/lib/schema-drift";
import { NextResponse } from "next/server";
import { syncGithubWebhookState } from "@/lib/github-webhook-sync";
import { enqueueAutomationJobRun } from "@/lib/automation-dispatch";
import { DUPLICATE_SENSITIVE_SOURCE_TYPES } from "@/lib/workflows/automation-guardrails";

import type { TriggerFilterAccountType } from "@/lib/flows/trigger-filter";
import type { TriggerEvent } from "@/lib/types";
import type { RouteFlowWaitsOutcome } from "@/lib/flows/wait-service";

import {
  type EnqueuedWebhookJob,
  type EventResult,
  type PendingWebhookJob,
  type StartedWebhookJob,
  type WebhookFlowRow,
  type WebhookRepoRow,
  type WebhookRequestContext,
  type WebhookSyncResult,
  getWebhookEventResults,
  buildFlowWebhookJobs,
  collectFlowAgentIds,
  loadFlowAgentSlugMap,
  loadWebhookFlowUserIds,
  loadWebhookFlows,
  evaluateMentionLoopBreaker,
  suppressMentionLoopJob,
  tryResumeFlowWaitsForGithubEvent,
  buildCheckRunRetryResponse,
  startWebhookJobRun as startWebhookJobRunInternal,
} from "./index";

async function syncWebhookStateOrResponse(
  context: WebhookRequestContext,
  retryFailures: boolean
) {
  try {
    return await syncGithubWebhookState(context.event, context.body);
  } catch (error) {
    if (retryFailures) throw error;
    console.error("Failed to sync GitHub webhook state:", {
      event: context.event,
      error,
    });
    return NextResponse.json(
      { error: "Failed to sync GitHub state" },
      { status: 500 }
    );
  }
}

async function loadFlowWebhookJobs(input: {
  installationId: number | null;
  results: EventResult[];
  repoRows: WebhookRepoRow[];
  payload: string;
  deliveryId: string | null;
  repoFullName: string | null;
  accountType: TriggerFilterAccountType;
  retryFailures: boolean;
}) {
  if (!input.installationId) return [];

  const triggerEvents = new Set(
    input.results
      .map((result) => result.triggerEvent)
      .filter(Boolean) as TriggerEvent[]
  );
  if (triggerEvents.size === 0) return [];

  const userIds = await loadWebhookFlowUserIds({
    repoRows: input.repoRows,
    installationId: input.installationId,
    throwOnError: input.retryFailures,
  });
  if (userIds instanceof Response) return userIds;
  if (userIds.length === 0) return [];

  const { flows, error } = await loadWebhookFlows(userIds);
  if (error) {
    if (input.retryFailures) throw error;
    console.error("Failed to load flows for webhook routing:", {
      installationId: input.installationId,
      error: error.message,
    });
    return NextResponse.json(
      { error: "Failed to load flows" },
      { status: 500 }
    );
  }

  const typedFlows = flows as WebhookFlowRow[];
  if (typedFlows.length === 0) return [];

  const agentSlugsById = await loadFlowAgentSlugMap(
    collectFlowAgentIds(typedFlows),
    input.installationId,
    input.retryFailures
  );
  if (agentSlugsById instanceof Response) return agentSlugsById;

  return buildFlowWebhookJobs({
    flows: typedFlows,
    results: input.results,
    repoRows: input.repoRows,
    payload: input.payload,
    deliveryId: input.deliveryId,
    repoFullName: input.repoFullName,
    agentSlugsById,
    installationId: input.installationId,
    accountType: input.accountType,
  });
}

function buildEnqueuedWebhookResult(
  job: PendingWebhookJob,
  result: Awaited<ReturnType<typeof enqueueAutomationJobRun>>
): EnqueuedWebhookJob {
  return {
    ...result,
    scope: job.scope,
    flowId: job.flow_id ?? null,
    flowVersionId: job.flow_version_id ?? null,
  };
}

function buildEnqueueWebhookFailure(
  job: PendingWebhookJob,
  message: string
): EnqueuedWebhookJob {
  console.error("Failed to enqueue webhook job:", {
    scope: job.scope,
    error: message,
  });
  return {
    jobRunId: null,
    outcome: "suppressed",
    reason: "ENQUEUE_FAILED",
    flowId: job.flow_id ?? null,
    flowVersionId: job.flow_version_id ?? null,
    scope: job.scope,
  };
}

async function enqueueWebhookJob(
  job: PendingWebhookJob,
  retryFailures: boolean
): Promise<EnqueuedWebhookJob> {
  try {
    const result = await enqueueAutomationJobRun({
      userId: job.userId,
      flowId: job.flow_id ?? null,
      flowVersionId: job.flow_version_id ?? null,
      repoId: job.scope.repoId,
      installationId: job.scope.installationId,
      sourceKind: job.scope.sourceKind,
      sourceType: job.scope.sourceType,
      idempotencyKey: job.idempotency_key,
      metadata: job.metadata,
      duplicateSensitive: DUPLICATE_SENSITIVE_SOURCE_TYPES.has(
        job.scope.sourceType
      ),
    });

    return buildEnqueuedWebhookResult(job, result);
  } catch (error) {
    if (retryFailures && isSchemaDriftError(error)) throw error;
    const message =
      error instanceof Error ? error.message : "Failed to enqueue webhook job";
    return buildEnqueueWebhookFailure(job, message);
  }
}

function getQueuedWebhookJobs(
  enqueueResults: EnqueuedWebhookJob[],
  reuse = false
) {
  return enqueueResults.filter(
    (result) =>
      result.jobRunId &&
      (result.outcome === "queued" ||
        (reuse && result.reason === "IDEMPOTENT_DUPLICATE"))
  );
}

async function startQueuedWebhookJob(
  job: EnqueuedWebhookJob
): Promise<StartedWebhookJob> {
  return startWebhookJobRunInternal(job.jobRunId!, "webhook");
}

function summarizeReasons(items: Array<{ reason: string | null | undefined }>) {
  return items.reduce<Record<string, number>>((acc, item) => {
    if (!item.reason) return acc;
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});
}

function buildWebhookPostResponse(
  sync: WebhookSyncResult,
  enqueueResults: EnqueuedWebhookJob[],
  started: StartedWebhookJob[],
  waitResume: RouteFlowWaitsOutcome | null
) {
  const queuedJobs = getQueuedWebhookJobs(enqueueResults);
  const deferred = started.filter((job) => job.deferred).length;
  const startFailed = started.filter(
    (job) => !job.started && !job.deferred && job.error
  ).length;

  return {
    ok: true,
    queued: queuedJobs.length,
    started: started.filter((job) => job.started).length,
    deferred,
    startFailed,
    suppressed: enqueueResults.filter(
      (result) => result.outcome === "suppressed"
    ).length,
    reason_counts: summarizeReasons([
      ...enqueueResults.map((result) => ({ reason: result.reason })),
      ...started.map((result) => ({ reason: result.reason })),
    ]),
    flow_waits: waitResume,
    sync,
  };
}

function preserveSchemaDrift(errors: unknown[]) {
  if (errors.some(isSchemaDriftError)) {
    throw new DatabaseSchemaError(
      "GitHub webhook database contract mismatch",
      SCHEMA_DRIFT_CODE
    );
  }
}

export async function dispatchVerifiedGithubWebhook(
  context: WebhookRequestContext,
  repoRows: WebhookRepoRow[],
  retryFailures = false
) {
  const syncResult = await syncWebhookStateOrResponse(context, retryFailures);
  if (syncResult instanceof Response) return syncResult;

  const checkRunRetryResponse = await buildCheckRunRetryResponse({
    context,
    repoRows,
    sync: syncResult,
  });
  if (checkRunRetryResponse) {
    if (retryFailures) {
      const result = (await checkRunRetryResponse.clone().json()) as {
        error?: unknown;
      };
      if (result.error) {
        preserveSchemaDrift([result.error]);
        throw new Error("GitHub check run retry dispatch failed");
      }
    }
    return checkRunRetryResponse;
  }

  // Resume any await_event waits keyed off this delivery before enqueuing new
  // automation jobs. The two paths are independent - one delivery can both
  // resume a wait and start a new flow run if the user has wired both - so we
  // surface the wait outcome alongside the normal dispatch summary.
  let waitResume: RouteFlowWaitsOutcome | null = null;
  let waitResumeFailed = false;
  try {
    waitResume = await tryResumeFlowWaitsForGithubEvent({ context, repoRows });
  } catch (error) {
    if (retryFailures && isSchemaDriftError(error)) throw error;
    waitResumeFailed = true;
    console.error("Failed to resume flow waits for GitHub event:", {
      installationId: context.installationId,
      deliveryId: context.deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Wait resumption and new jobs are independent. Surface wait failures only
  // after admitting the delivery's idempotent jobs, including on every retry.
  const assertWaitRoutingSucceeded = () => {
    if (!retryFailures) return;
    if (waitResume?.rollbackFailed) {
      console.error("Native GitHub wait requires operator repair", {
        deliveryId: context.deliveryId,
        installationId: context.installationId,
        completeFailed: waitResume.completeFailed,
        failureCount: waitResume.failures.length,
        rollbackFailed: true,
      });
      throw new AbortTaskRunError(
        "GitHub flow wait requires operator repair after rollback failure"
      );
    }
    if (
      waitResumeFailed ||
      (waitResume?.completeFailed ?? 0) > 0 ||
      (waitResume?.failures.length ?? 0) > 0
    ) {
      console.error("Native GitHub wait routing failed", {
        deliveryId: context.deliveryId,
        installationId: context.installationId,
        completeFailed: waitResume?.completeFailed ?? 0,
        failureCount: waitResume?.failures.length ?? 0,
        lookupFailed: waitResumeFailed,
      });
      throw new Error("GitHub webhook wait routing failed");
    }
  };
  if (retryFailures) preserveSchemaDrift(waitResume?.failures ?? []);
  const results = getWebhookEventResults(context.event, context.body);
  if (results.length === 0) {
    assertWaitRoutingSucceeded();
    return NextResponse.json({
      ok: true,
      skipped: true,
      flow_waits: waitResume,
      sync: syncResult,
    });
  }

  const jobs = await loadFlowWebhookJobs({
    installationId: context.installationId,
    results,
    repoRows,
    payload: context.payload,
    deliveryId: context.deliveryId,
    repoFullName: context.repoFullName,
    accountType: context.accountType,
    retryFailures,
  });
  if (jobs instanceof Response) return jobs;
  if (jobs.length === 0) {
    assertWaitRoutingSucceeded();
    return NextResponse.json({
      ok: true,
      queued: 0,
      flow_waits: waitResume,
      sync: syncResult,
    });
  }

  // Evaluate the mention loop-breaker once for the whole delivery: snapshot the
  // recent count per repo+issue before any enqueue, so the in-batch tally is
  // added without counting this delivery's previous native attempts again.
  const loopTripped = await evaluateMentionLoopBreaker(
    jobs,
    undefined,
    retryFailures ? context.deliveryId : null
  );
  const enqueueResults = await Promise.all(
    jobs.map((job, index) =>
      loopTripped[index]
        ? suppressMentionLoopJob(job)
        : enqueueWebhookJob(job, retryFailures)
    )
  );
  const started = await Promise.all(
    getQueuedWebhookJobs(enqueueResults, retryFailures).map(
      startQueuedWebhookJob
    )
  );

  if (retryFailures) preserveSchemaDrift(started.map((result) => result.error));
  assertWaitRoutingSucceeded();
  if (
    retryFailures &&
    (enqueueResults.some((result) => result.reason === "ENQUEUE_FAILED") ||
      started.some((result) => result.error))
  ) {
    throw new Error("GitHub webhook dispatch failed");
  }
  return NextResponse.json(
    buildWebhookPostResponse(syncResult, enqueueResults, started, waitResume)
  );
}
