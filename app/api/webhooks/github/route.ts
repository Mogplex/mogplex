import crypto from "node:crypto";
import { NextResponse } from "next/server";

import {
  type RawWebhookRequestContext,
  type WebhookRepoRow,
  type WebhookRequestContext,
  type WebhookSyncResult,
  loadWebhookRepoRows,
} from "./_lib";
import {
  parseWebhookRequest,
  parseWebhookRequestBody,
} from "./_lib/request-context";
import { dispatchVerifiedGithubWebhook } from "./_lib/verified-dispatch";
import { forwardNativeWebhook } from "@/lib/trigger/webhook-forwarding";

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
  handleDependabotAlert,
  getWebhookEventResults,
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

export async function POST(request: Request) {
  const rawContext = await parseWebhookRequest(request);
  const globalSignatureResponse = validateGlobalWebhookSignature(rawContext);
  if (globalSignatureResponse) return globalSignatureResponse;

  if (rawContext.globalSecret && process.env.TRIGGER_GITHUB_WEBHOOK_URL) {
    return forwardNativeWebhook("github", rawContext.payload, request.headers);
  }

  const context = parseWebhookRequestBody(rawContext);
  const repoRows = await loadWebhookRepoRows(
    context.repoGithubId,
    context.installationId
  );

  const signatureResponse = validateWebhookSignature(context, repoRows);
  if (signatureResponse) return signatureResponse;

  return dispatchVerifiedGithubWebhook(context, repoRows);
}
