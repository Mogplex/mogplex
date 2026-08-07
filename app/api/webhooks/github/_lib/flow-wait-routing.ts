import { isMogplexAuthoredComment } from "@/lib/github-automation-marker";
import {
  routeGithubCiCompletedEventToFlowWaits,
  routeGithubCommentAddedEventToFlowWaits,
  routeGithubLabeledEventToFlowWaits,
  routeGithubVercelPreviewReadyEventToFlowWaits,
  type RouteFlowWaitsOutcome,
} from "@/lib/flows/wait-service";
import {
  BOT_LOGIN,
  type WebhookRepoRow,
  type WebhookRequestContext,
} from "./types";

function findDeliveryRepoRow(
  repoRows: WebhookRepoRow[],
  installationId: number | null
) {
  return (
    repoRows.find((row) => row.github_installation_id === installationId) ??
    null
  );
}

function urlLooksLikeVercel(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "vercel.app" || hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export function isVercelDeploymentStatus(body: Record<string, unknown>) {
  const deployment =
    body.deployment && typeof body.deployment === "object"
      ? (body.deployment as Record<string, unknown>)
      : null;
  const status =
    body.deployment_status && typeof body.deployment_status === "object"
      ? (body.deployment_status as Record<string, unknown>)
      : null;
  const creator =
    deployment?.creator && typeof deployment.creator === "object"
      ? (deployment.creator as Record<string, unknown>)
      : null;
  const creatorLogin =
    typeof creator?.login === "string" ? creator.login.toLowerCase() : "";

  return (
    creatorLogin.includes("vercel") ||
    urlLooksLikeVercel(status?.environment_url) ||
    urlLooksLikeVercel(status?.target_url)
  );
}

// Resume any flow_waits matching a `labeled` action on this delivery. Returns
// null when the event is not a labeled action (so the caller knows to skip the
// resume step).
export async function tryResumeFlowWaitsForLabeledEvent(input: {
  context: WebhookRequestContext;
  repoRows: WebhookRepoRow[];
}): Promise<RouteFlowWaitsOutcome | null> {
  const { context, repoRows } = input;
  if (context.event !== "pull_request" && context.event !== "issues") {
    return null;
  }
  const body = context.body as Record<string, unknown>;
  if (body.action !== "labeled") {
    return null;
  }
  const labelRecord =
    body.label && typeof body.label === "object"
      ? (body.label as Record<string, unknown>)
      : null;
  const labelName =
    typeof labelRecord?.name === "string" ? labelRecord.name : null;
  if (!labelName) {
    return null;
  }

  const isPullRequest = context.event === "pull_request";
  // Strictly match a repo row to this delivery's installation. Falling back to
  // the first row in `repoRows` would cross tenants because multiple users can
  // install the same GitHub repo; the rows share `github_id` but belong to
  // different installations. If we can't find an installation-scoped row, pass
  // null and let the wait service constrain by installation alone (it will
  // only match repo-agnostic waits).
  const repoRow =
    repoRows.find(
      (row) => row.github_installation_id === context.installationId
    ) ?? null;

  return routeGithubLabeledEventToFlowWaits({
    installationId: context.installationId,
    repoId: repoRow?.id ?? null,
    repoFullName: context.repoFullName,
    accountType: context.accountType,
    labelName,
    isPullRequest,
    deliveryId: context.deliveryId,
    payload: body,
  });
}

// Routes every currently supported GitHub-backed await event. The existing
// labeled helper stays exported for focused tests and compatibility; this
// dispatcher adds CI completion and Vercel preview readiness without coupling
// their matching rules to normal flow-trigger enqueue behavior.
export async function tryResumeFlowWaitsForGithubEvent(input: {
  context: WebhookRequestContext;
  repoRows: WebhookRepoRow[];
}): Promise<RouteFlowWaitsOutcome | null> {
  const labeled = await tryResumeFlowWaitsForLabeledEvent(input);
  if (labeled) return labeled;

  const { context, repoRows } = input;
  const body = context.body as Record<string, unknown>;
  const repoRow = findDeliveryRepoRow(repoRows, context.installationId);

  if (
    (context.event === "issue_comment" ||
      context.event === "pull_request_review_comment") &&
    body.action === "created"
  ) {
    const comment =
      body.comment && typeof body.comment === "object"
        ? (body.comment as Record<string, unknown>)
        : null;
    const user =
      comment?.user && typeof comment.user === "object"
        ? (comment.user as Record<string, unknown>)
        : null;
    const bodyText = typeof comment?.body === "string" ? comment.body : "";
    const authorLogin = typeof user?.login === "string" ? user.login : "";
    if (
      !authorLogin ||
      authorLogin === BOT_LOGIN ||
      isMogplexAuthoredComment(bodyText)
    ) {
      return null;
    }

    const entity =
      context.event === "issue_comment"
        ? body.issue && typeof body.issue === "object"
          ? (body.issue as Record<string, unknown>)
          : null
        : body.pull_request && typeof body.pull_request === "object"
          ? (body.pull_request as Record<string, unknown>)
          : null;
    const issueNumber =
      typeof entity?.number === "number" &&
      Number.isSafeInteger(entity.number) &&
      entity.number > 0
        ? entity.number
        : null;
    if (issueNumber == null) return null;

    return routeGithubCommentAddedEventToFlowWaits({
      installationId: context.installationId,
      repoId: repoRow?.id ?? null,
      issueNumber,
      isPullRequest:
        context.event === "pull_request_review_comment" ||
        Boolean(entity?.pull_request),
      authorLogin,
      body: bodyText,
      deliveryId: context.deliveryId,
      payload: body,
    });
  }

  if (context.event === "workflow_run" && body.action === "completed") {
    const workflowRun =
      body.workflow_run && typeof body.workflow_run === "object"
        ? (body.workflow_run as Record<string, unknown>)
        : null;
    const workflowName =
      typeof workflowRun?.name === "string" ? workflowRun.name : "";
    const headSha =
      typeof workflowRun?.head_sha === "string" ? workflowRun.head_sha : "";
    const conclusion =
      typeof workflowRun?.conclusion === "string"
        ? workflowRun.conclusion
        : null;
    if (!workflowName || !headSha) return null;

    return routeGithubCiCompletedEventToFlowWaits({
      installationId: context.installationId,
      repoId: repoRow?.id ?? null,
      workflowName,
      conclusion,
      headSha,
      deliveryId: context.deliveryId,
      payload: body,
    });
  }

  if (context.event === "check_run" && body.action === "completed") {
    const checkRun =
      body.check_run && typeof body.check_run === "object"
        ? (body.check_run as Record<string, unknown>)
        : null;
    const workflowName =
      typeof checkRun?.name === "string" ? checkRun.name : "";
    const headSha =
      typeof checkRun?.head_sha === "string" ? checkRun.head_sha : "";
    const conclusion =
      typeof checkRun?.conclusion === "string" ? checkRun.conclusion : null;
    if (!workflowName || !headSha) return null;

    return routeGithubCiCompletedEventToFlowWaits({
      installationId: context.installationId,
      repoId: repoRow?.id ?? null,
      workflowName,
      conclusion,
      headSha,
      deliveryId: context.deliveryId,
      payload: body,
    });
  }

  if (context.event === "deployment_status") {
    const deployment =
      body.deployment && typeof body.deployment === "object"
        ? (body.deployment as Record<string, unknown>)
        : null;
    const status =
      body.deployment_status && typeof body.deployment_status === "object"
        ? (body.deployment_status as Record<string, unknown>)
        : null;
    if (status?.state !== "success" || !isVercelDeploymentStatus(body)) {
      return null;
    }
    const environment =
      typeof status.environment === "string"
        ? status.environment
        : typeof deployment?.environment === "string"
          ? deployment.environment
          : "";
    const sha = typeof deployment?.sha === "string" ? deployment.sha : "";
    if (!environment || !sha) return null;

    return routeGithubVercelPreviewReadyEventToFlowWaits({
      installationId: context.installationId,
      repoId: repoRow?.id ?? null,
      environment,
      sha,
      deliveryId: context.deliveryId,
      payload: body,
    });
  }

  return null;
}
