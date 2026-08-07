import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { syncGithubWebhookState } from "@/lib/github-webhook-sync";
import { enqueueAutomationJobRun } from "@/lib/automation-dispatch";
import { DUPLICATE_SENSITIVE_SOURCE_TYPES } from "@/lib/workflows/automation-guardrails";
import {
  isKnownAccountType,
  normalizeAccountType,
} from "@/lib/flows/trigger-filter";
import type { TriggerFilterAccountType } from "@/lib/flows/trigger-filter";
import type { TriggerEvent } from "@/lib/types";
import type { RouteFlowWaitsOutcome } from "@/lib/flows/wait-service";

import {
  type EnqueuedWebhookJob,
  type EventResult,
  type PendingWebhookJob,
  type RawWebhookRequestContext,
  type StartedWebhookJob,
  type WebhookFlowRow,
  type WebhookPayloadBody,
  type WebhookRepoRow,
  type WebhookRequestContext,
  type WebhookSyncResult,
  getWebhookEventResults,
  buildFlowWebhookJobs,
  collectFlowAgentIds,
  loadWebhookRepoRows,
  loadFlowAgentSlugMap,
  loadWebhookFlowUserIds,
  loadWebhookFlows,
  evaluateMentionLoopBreaker,
  suppressMentionLoopJob,
  tryResumeFlowWaitsForGithubEvent,
  buildCheckRunRetryResponse,
  startWebhookJobRun as startWebhookJobRunInternal,
} from "./_lib";

// Re-exports for tests
export {
  pickWebhookRepoForUser,
  buildFlowWebhookJobs,
  isPrReviewCheckRunRetryRequest,
  doesCheckRunRetryContextMatchWebhookRepo,
  doesTagMatchPattern,
  handleLabeledAction,
  handlePullRequest,
  handleTagPush,
  handleCIEvent,
  handleIssueComment,
  handlePRReviewComment,
  handleCommitComment,
  countInBatchMentionSiblings,
  evaluateMentionLoopBreaker,
  startWebhookJobRun,
  tryResumeFlowWaitsForLabeledEvent,
  isVercelDeploymentStatus,
  tryResumeFlowWaitsForGithubEvent,
  buildCheckRunRetryResponse,
} from "./_lib";

function verifySignature(payload: string, signature: string, secret: string) {
  const hmac = crypto.createHmac("sha256", secret);
  const digest = `sha256=${hmac.update(payload).digest("hex")}`;
  const digestBuf = Buffer.from(digest);
  const sigBuf = Buffer.from(signature);
  if (digestBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(digestBuf, sigBuf);
}

function buildInvalidSignatureResponse() {
  return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
}

function buildSkippedWebhookResponse(sync?: WebhookSyncResult) {
  return NextResponse.json(
    sync ? { ok: true, skipped: true, sync } : { ok: true, skipped: true }
  );
}

function readWebhookInstallationId(body: WebhookPayloadBody) {
  return body.installation?.id ?? null;
}

function readWebhookRepoGithubId(body: WebhookPayloadBody) {
  return typeof body.repository?.id === "number" ? body.repository.id : null;
}

function readWebhookRepoFullName(body: WebhookPayloadBody) {
  return typeof body.repository?.full_name === "string"
    ? body.repository.full_name
    : null;
}

async function parseWebhookRequest(
  request: Request
): Promise<RawWebhookRequestContext> {
  return {
    event: request.headers.get("x-github-event"),
    deliveryId: request.headers.get("x-github-delivery")?.trim() || null,
    signature: request.headers.get("x-hub-signature-256") || "",
    globalSecret: process.env.GITHUB_WEBHOOK_SECRET?.trim() || null,
    payload: await request.text(),
  };
}

function readWebhookAccountType(
  body: WebhookPayloadBody
): TriggerFilterAccountType {
  const raw =
    body.installation?.target_type ?? body.installation?.account?.type;
  const normalized = normalizeAccountType(raw);
  if (
    typeof raw === "string" &&
    raw.trim() !== "" &&
    !isKnownAccountType(raw)
  ) {
    console.warn(
      JSON.stringify({
        event: "webhook_account_type_unknown",
        raw,
        installation_id: readWebhookInstallationId(body),
        fallback: normalized,
      })
    );
  }
  return normalized;
}

function parseWebhookRequestBody(
  context: RawWebhookRequestContext
): WebhookRequestContext {
  const body = JSON.parse(context.payload) as WebhookPayloadBody;

  return {
    event: context.event,
    deliveryId: context.deliveryId,
    signature: context.signature,
    globalSecret: context.globalSecret,
    payload: context.payload,
    body,
    installationId: readWebhookInstallationId(body),
    repoGithubId: readWebhookRepoGithubId(body),
    repoFullName: readWebhookRepoFullName(body),
    accountType: readWebhookAccountType(body),
  };
}

function validateGlobalWebhookSignature(context: RawWebhookRequestContext) {
  if (!context.globalSecret) return null;

  return verifySignature(
    context.payload,
    context.signature,
    context.globalSecret
  )
    ? null
    : buildInvalidSignatureResponse();
}

function verifyRepoWebhookSignature(
  payload: string,
  signature: string,
  repoRows: WebhookRepoRow[]
) {
  return repoRows.some((repo) => {
    const repoSecret = repo.webhook_secret?.trim();
    return repoSecret ? verifySignature(payload, signature, repoSecret) : false;
  });
}

function validateWebhookSignature(
  context: WebhookRequestContext,
  repoRows: WebhookRepoRow[]
) {
  if (context.globalSecret) {
    return verifySignature(
      context.payload,
      context.signature,
      context.globalSecret
    )
      ? null
      : buildInvalidSignatureResponse();
  }

  if (repoRows.length === 0) return buildSkippedWebhookResponse();

  return verifyRepoWebhookSignature(
    context.payload,
    context.signature,
    repoRows
  )
    ? null
    : buildInvalidSignatureResponse();
}

async function syncWebhookStateOrResponse(context: WebhookRequestContext) {
  try {
    return await syncGithubWebhookState(context.event, context.body);
  } catch (error) {
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
  });
  if (userIds instanceof Response) return userIds;
  if (userIds.length === 0) return [];

  const { flows, error } = await loadWebhookFlows(userIds);
  if (error) {
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
    input.installationId
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
  job: PendingWebhookJob
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
    const message =
      error instanceof Error ? error.message : "Failed to enqueue webhook job";
    return buildEnqueueWebhookFailure(job, message);
  }
}

function getQueuedWebhookJobs(enqueueResults: EnqueuedWebhookJob[]) {
  return enqueueResults.filter(
    (result) => result.outcome === "queued" && result.jobRunId
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

export async function POST(request: Request) {
  const rawContext = await parseWebhookRequest(request);
  const globalSignatureResponse = validateGlobalWebhookSignature(rawContext);
  if (globalSignatureResponse) return globalSignatureResponse;

  const context = parseWebhookRequestBody(rawContext);
  const repoRows = await loadWebhookRepoRows(
    context.repoGithubId,
    context.installationId
  );

  const signatureResponse = validateWebhookSignature(context, repoRows);
  if (signatureResponse) return signatureResponse;

  const syncResult = await syncWebhookStateOrResponse(context);
  if (syncResult instanceof Response) return syncResult;

  const checkRunRetryResponse = await buildCheckRunRetryResponse({
    context,
    repoRows,
    sync: syncResult,
  });
  if (checkRunRetryResponse) return checkRunRetryResponse;

  // Resume any await_event waits keyed off this delivery before enqueuing new
  // automation jobs. The two paths are independent - one delivery can both
  // resume a wait and start a new flow run if the user has wired both - so we
  // surface the wait outcome alongside the normal dispatch summary.
  let waitResume: RouteFlowWaitsOutcome | null = null;
  try {
    waitResume = await tryResumeFlowWaitsForGithubEvent({ context, repoRows });
  } catch (error) {
    console.error("Failed to resume flow waits for GitHub event:", {
      installationId: context.installationId,
      deliveryId: context.deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const results = getWebhookEventResults(context.event, context.body);
  if (results.length === 0) {
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
  });
  if (jobs instanceof Response) return jobs;
  if (jobs.length === 0) {
    return NextResponse.json({
      ok: true,
      queued: 0,
      flow_waits: waitResume,
      sync: syncResult,
    });
  }

  // Evaluate the mention loop-breaker once for the whole delivery: snapshot the
  // recent count per repo+issue before any enqueue, so the in-batch tally is
  // added to a count that cannot yet include the batch's own siblings.
  const loopTripped = await evaluateMentionLoopBreaker(jobs);
  const enqueueResults = await Promise.all(
    jobs.map((job, index) =>
      loopTripped[index] ? suppressMentionLoopJob(job) : enqueueWebhookJob(job)
    )
  );
  const started = await Promise.all(
    getQueuedWebhookJobs(enqueueResults).map(startQueuedWebhookJob)
  );

  return NextResponse.json(
    buildWebhookPostResponse(syncResult, enqueueResults, started, waitResume)
  );
}
