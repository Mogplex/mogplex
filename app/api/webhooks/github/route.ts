import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { syncGithubWebhookState } from "@/lib/github-webhook-sync";
import {
  isMogplexPrReviewCheckName,
  isMogplexPrReviewRerunEvent,
} from "@/lib/github-check-runs";
import {
  enqueueJobRunRetry,
  getDefaultJobRunRetryVersionMode,
  isJobRunRetryVersionError,
  loadJobRunRetryContext,
} from "@/lib/job-run-retry";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  countRecentMentionEnqueues,
  enqueueAutomationJobRun,
  logAutomationDispatchEvent,
} from "@/lib/automation-dispatch";
import { isMogplexAuthoredComment } from "@/lib/github-automation-marker";
import {
  routeGithubCiCompletedEventToFlowWaits,
  routeGithubCommentAddedEventToFlowWaits,
  routeGithubLabeledEventToFlowWaits,
  routeGithubVercelPreviewReadyEventToFlowWaits,
  type RouteFlowWaitsOutcome,
} from "@/lib/flows/wait-service";
import { buildPrReviewHeadShaDedupKey } from "@/lib/automation-review";
import {
  coerceGraph,
  getEntryAgentIds,
  getStartConfig,
} from "@/lib/flows/graph";
import {
  evaluateTriggerFilter,
  isKnownAccountType,
  normalizeAccountType,
  type TriggerFilterAccountType,
} from "@/lib/flows/trigger-filter";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-workflow";
import { DUPLICATE_SENSITIVE_SOURCE_TYPES } from "@/lib/workflows/automation-guardrails";
import type { TriggerEvent } from "@/lib/types";
import type { GithubRepoPayload } from "@/lib/github-sync";

const BOT_LOGIN = "mogplex[bot]";

// Loop-breaker backstop: cap how many `mention` runs a single PR/issue can
// queue within a rolling window, in case the marker-based self-loop guard is
// ever bypassed. Bounds a worst-case runaway to MENTION_LOOP_MAX runs.
const MENTION_LOOP_WINDOW_MINUTES = 10;
const MENTION_LOOP_MAX = 3;

function verifySignature(payload: string, signature: string, secret: string) {
  const hmac = crypto.createHmac("sha256", secret);
  const digest = `sha256=${hmac.update(payload).digest("hex")}`;
  const digestBuf = Buffer.from(digest);
  const sigBuf = Buffer.from(signature);
  if (digestBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(digestBuf, sigBuf);
}

type EventResult = {
  assignmentType: string;
  triggerEvent?: TriggerEvent;
  metadata: Record<string, unknown>;
  agentSlug?: string | null;
  authorLogin?: string | null;
  authorIsBot?: boolean | null;
};

type WebhookRepoRow = {
  id: string;
  user_id: string;
  full_name?: string | null;
  github_installation_id?: number | null;
  product_team_id?: string | null;
  root_directory?: string | null;
  parent_repo_id?: string | null;
  webhook_secret?: string | null;
};

type WebhookFlowRow = {
  id: string;
  user_id: string;
  installation_id: number;
  published_version_id: string;
  published_version:
    | {
        id: string;
        graph: unknown;
      }
    | Array<{
        id: string;
        graph: unknown;
      }>
    | null;
};

// Flows are the only dispatch shape a webhook produces. The assignment and
// trigger arms are gone: both built a run straight from the agent row, so they
// executed `agents.model` with no node able to override it. The node is now the
// only source of a step's model, and only a flow has nodes.
type PendingWebhookJob = {
  userId: string;
  flow_id?: string | null;
  flow_version_id?: string | null;
  status: "pending";
  metadata: Record<string, unknown>;
  idempotency_key: string;
  scope: {
    sourceKind: "flow";
    sourceType: string;
    sourceId: string;
    repoId: string | null;
    installationId: number | null;
  };
};

type WebhookSyncResult = Awaited<ReturnType<typeof syncGithubWebhookState>>;

type EnqueuedWebhookJob = Awaited<
  ReturnType<typeof enqueueAutomationJobRun>
> & {
  scope: PendingWebhookJob["scope"];
  flowId: string | null;
  flowVersionId: string | null;
};

type StartedWebhookJob = {
  started: boolean;
  deferred: boolean;
  runtimeProvider: string | null;
  runtimeRunId: string | null;
  workflowRunId: string | null;
  status: string | null;
  reason: string | null;
  error: string | null;
};

type WebhookInstallation = {
  id?: number;
  account?: {
    login?: string;
    type?: string;
  };
  target_type?: string;
  permissions?: Record<string, string>;
};

type WebhookPayloadBody = Record<string, unknown> & {
  action?: string;
  sender?: { login?: string; type?: string };
  installation?: WebhookInstallation;
  repository?: GithubRepoPayload;
  repositories_added?: GithubRepoPayload[];
  repositories_removed?: Array<{ id: number }>;
};

type WebhookRequestContext = {
  event: string | null;
  deliveryId: string | null;
  signature: string;
  globalSecret: string | null;
  payload: string;
  body: WebhookPayloadBody;
  installationId: number | null;
  repoGithubId: number | null;
  repoFullName: string | null;
  accountType: TriggerFilterAccountType;
};

type WebhookCheckRunBody = {
  id?: number;
  external_id?: string | null;
  name?: string | null;
  head_sha?: string | null;
  details_url?: string | null;
};

type WebhookRequestedAction = {
  identifier?: string | null;
};

type CheckRunRetryContextMatchInput = {
  repoRows: WebhookRepoRow[];
  repoId: string | null;
  installationId: number | null;
  webhookInstallationId: number | null;
};

type RawWebhookRequestContext = Pick<
  WebhookRequestContext,
  "event" | "deliveryId" | "signature" | "globalSecret" | "payload"
>;

function parseMentions(text: string): { hasMention: boolean; slugs: string[] } {
  const mentionRegex = /@mogplex(?:\/([\da-z-]+))?/gi;
  const slugs: string[] = [];
  let hasMention = false;
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    hasMention = true;
    if (match[1]) slugs.push(match[1]);
  }
  return { hasMention, slugs };
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

function buildWebhookJobIdempotencyKey(
  scope: string,
  payload: string,
  deliveryId: string | null
) {
  const source =
    deliveryId || crypto.createHash("sha256").update(payload).digest("hex");
  return `github-webhook:${scope}:${source}`;
}

function applyReviewDedupMetadata(input: {
  sourceKind: "flow";
  sourceType: string;
  sourceId: string;
  repoId: string | null;
  installationId: number | null;
  metadata: Record<string, unknown>;
  fallbackScope: string;
  payload: string;
  deliveryId: string | null;
}) {
  const reviewDedupKey = buildPrReviewHeadShaDedupKey({
    sourceKind: input.sourceKind,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    repoId: input.repoId,
    installationId: input.installationId,
    metadata: input.metadata,
  });

  return {
    idempotencyKey:
      reviewDedupKey ??
      buildWebhookJobIdempotencyKey(
        input.fallbackScope,
        input.payload,
        input.deliveryId
      ),
    metadata: reviewDedupKey
      ? {
          ...input.metadata,
          review_dedup_key: reviewDedupKey,
        }
      : input.metadata,
  };
}

export function pickWebhookRepoForUser(
  repos: WebhookRepoRow[],
  userId: string
) {
  const candidates = repos.filter((repo) => repo.user_id === userId);
  if (candidates.length === 0) return null;

  return (
    candidates.find((repo) => !repo.root_directory && !repo.parent_repo_id) ||
    candidates.find((repo) => !repo.root_directory) ||
    candidates[0]
  );
}

function getPublishedFlowVersion(flow: WebhookFlowRow) {
  return Array.isArray(flow.published_version)
    ? (flow.published_version[0] ?? null)
    : flow.published_version;
}

function resolveWebhookJobTeamId(
  metadata: Record<string, unknown>,
  repo: WebhookRepoRow | null
) {
  const raw = metadata.team_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return repo?.product_team_id ?? null;
}

function doesMentionFlowMatchAgentSlug(
  graph: ReturnType<typeof coerceGraph>,
  result: EventResult,
  agentSlugsById: Map<string, string | null>
) {
  if (!result.agentSlug) {
    return true;
  }

  return getEntryAgentIds(graph).some(
    (agentId) => agentSlugsById.get(agentId) === result.agentSlug
  );
}

type FlowGraphCacheEntry = {
  graph: ReturnType<typeof coerceGraph>;
  start: ReturnType<typeof getStartConfig>;
};

// Exact label-name comparison, matching the await_event wait-service routing.
// An empty/absent start labelName matches any label — consistent with the
// start filter's "empty = all" semantics.
function doesLabeledResultMatchStart(
  start: NonNullable<ReturnType<typeof getStartConfig>>,
  result: EventResult
) {
  const labelName =
    typeof result.metadata.label_name === "string"
      ? result.metadata.label_name
      : null;
  if (!labelName) return false;
  if (start.labelPrOnly === true && result.metadata.is_pr !== true) {
    return false;
  }

  const wanted =
    typeof start.labelName === "string" ? start.labelName.trim() : "";
  return wanted.length === 0 || wanted === labelName;
}

function escapeTagPatternSegment(segment: string) {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Minimal glob over tag names: `*` matches any run of characters, everything
// else is literal. An empty/absent pattern matches any tag — consistent with
// the labeled trigger's "empty = any label" semantics.
export function doesTagMatchPattern(pattern: string, tagName: string) {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return true;

  const regex = new RegExp(
    `^${trimmed.split("*").map(escapeTagPatternSegment).join(".*")}$`
  );
  return regex.test(tagName);
}

function doesTagPushResultMatchStart(
  start: NonNullable<ReturnType<typeof getStartConfig>>,
  result: EventResult
) {
  const tagName =
    typeof result.metadata.tag_name === "string"
      ? result.metadata.tag_name
      : null;
  if (!tagName) return false;

  const pattern = typeof start.tagPattern === "string" ? start.tagPattern : "";
  return doesTagMatchPattern(pattern, tagName);
}

function flowMatchesTriggerResult(
  flow: WebhookFlowRow,
  result: EventResult,
  agentSlugsById: Map<string, string | null>,
  cached: FlowGraphCacheEntry | null
) {
  if (!cached || !result.triggerEvent) {
    return false;
  }

  const { graph, start } = cached;
  if (start?.event !== result.triggerEvent) {
    return false;
  }

  if (start.event === "labeled") {
    return doesLabeledResultMatchStart(start, result);
  }

  if (start.event === "tag_push") {
    return doesTagPushResultMatchStart(start, result);
  }

  if (start.event !== "mention") {
    return true;
  }

  return result.agentSlug
    ? doesMentionFlowMatchAgentSlug(graph, result, agentSlugsById)
    : true;
}

function buildFlowWebhookJobMetadata(
  flow: WebhookFlowRow,
  result: EventResult,
  repoForUser: WebhookRepoRow | null,
  repoFullName: string | null,
  installationId: number | null | undefined
) {
  const deliveryInstallationId =
    typeof installationId === "number" ? installationId : flow.installation_id;

  return {
    ...result.metadata,
    repo_id: repoForUser?.id ?? null,
    repo_full_name: repoForUser?.full_name ?? repoFullName,
    installation_id: deliveryInstallationId,
    team_id: resolveWebhookJobTeamId(result.metadata, repoForUser),
    source_type: result.triggerEvent,
    flow_id: flow.id,
    flow_version_id: flow.published_version_id,
  };
}

function buildFlowWebhookJobScope(
  flow: WebhookFlowRow,
  result: EventResult,
  repoId: string | null,
  installationId: number | null | undefined
) {
  return {
    sourceKind: "flow" as const,
    sourceType: result.triggerEvent ?? "unknown",
    sourceId: flow.id,
    repoId,
    installationId:
      typeof installationId === "number"
        ? installationId
        : flow.installation_id,
  };
}

function createFlowWebhookJob(
  flow: WebhookFlowRow,
  result: EventResult,
  input: {
    repoRows: WebhookRepoRow[];
    payload: string;
    deliveryId: string | null;
    repoFullName: string | null;
    installationId?: number | null;
  }
): PendingWebhookJob {
  const repoForUser = pickWebhookRepoForUser(input.repoRows, flow.user_id);
  const metadata = buildFlowWebhookJobMetadata(
    flow,
    result,
    repoForUser,
    input.repoFullName,
    input.installationId
  );
  const dedup = applyReviewDedupMetadata({
    sourceKind: "flow",
    sourceType: result.triggerEvent ?? "unknown",
    sourceId: flow.id,
    repoId: repoForUser?.id ?? null,
    installationId:
      typeof input.installationId === "number"
        ? input.installationId
        : flow.installation_id,
    metadata,
    fallbackScope: `flow:${flow.id}`,
    payload: input.payload,
    deliveryId: input.deliveryId,
  });

  return {
    userId: flow.user_id,
    status: "pending",
    metadata: dedup.metadata,
    flow_id: flow.id,
    flow_version_id: flow.published_version_id,
    idempotency_key: dedup.idempotencyKey,
    scope: buildFlowWebhookJobScope(
      flow,
      result,
      repoForUser?.id ?? null,
      input.installationId
    ),
  };
}

function isPullRequestTriggerAction(action: string) {
  return ["opened", "synchronize", "ready_for_review", "reopened"].includes(
    action
  );
}

function isBotSynchronizePullRequest(
  body: Record<string, unknown>,
  action: string
) {
  const sender = body.sender as { login?: string; type?: string } | undefined;
  return (
    action === "synchronize" &&
    (sender?.type === "Bot" || sender?.login === BOT_LOGIN)
  );
}

function shouldSkipDraftPullRequest(
  pr:
    | {
        draft?: boolean;
      }
    | undefined,
  action: string
) {
  return Boolean(pr?.draft && action !== "ready_for_review");
}

function buildPullRequestHeadMetadata(pr: {
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
}) {
  return {
    head_ref: pr.head?.ref ?? null,
    head_sha: pr.head?.sha ?? null,
    head_repo_full_name: pr.head?.repo?.full_name ?? null,
  };
}

function buildPullRequestBaseMetadata(pr: {
  base?: { ref?: string; sha?: string; repo?: { full_name?: string } };
}) {
  return {
    base_ref: pr.base?.ref ?? null,
    base_sha: pr.base?.sha ?? null,
    base_repo_full_name: pr.base?.repo?.full_name ?? null,
  };
}

function buildPullRequestMetadata(pr: {
  number: number;
  html_url: string;
  title?: string;
  user?: { login?: string; type?: string };
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
  base?: { ref?: string; sha?: string; repo?: { full_name?: string } };
}) {
  return {
    pr_number: pr.number,
    pr_url: pr.html_url,
    pr_title: pr.title ?? null,
    pr_author: pr.user?.login ?? null,
    ...buildPullRequestHeadMetadata(pr),
    ...buildPullRequestBaseMetadata(pr),
  };
}

function flowMatchesTriggerFilter(
  cached: FlowGraphCacheEntry | null,
  input: {
    installationId?: number | null;
    repoFullName: string | null;
    accountType?: TriggerFilterAccountType;
  },
  result: EventResult
) {
  if (!cached) return false;
  if (input.installationId == null || input.accountType == null) {
    return true;
  }

  return evaluateTriggerFilter(cached.start?.filter, {
    installationId: input.installationId,
    repoFullName: input.repoFullName,
    accountType: input.accountType,
    authorLogin: result.authorLogin ?? null,
    authorIsBot: result.authorIsBot ?? null,
  });
}

export function buildFlowWebhookJobs(input: {
  flows: WebhookFlowRow[];
  results: EventResult[];
  repoRows: WebhookRepoRow[];
  payload: string;
  deliveryId: string | null;
  repoFullName: string | null;
  agentSlugsById: Map<string, string | null>;
  installationId?: number | null;
  accountType?: TriggerFilterAccountType;
}): PendingWebhookJob[] {
  // Coerce each published graph exactly once per delivery and reuse it for
  // both job-building and the routing filter log. Webhook routing is
  // a hot path; without this cache an installation with N flows × M trigger
  // results would re-coerce the same JSONB N×M times, then the log pass would
  // do it once more.
  const flowGraphCache = new Map<string, FlowGraphCacheEntry | null>();
  for (const flow of input.flows) {
    const publishedVersion = getPublishedFlowVersion(flow);
    if (!publishedVersion) {
      flowGraphCache.set(flow.id, null);
      continue;
    }
    const graph = coerceGraph(publishedVersion.graph);
    flowGraphCache.set(flow.id, { graph, start: getStartConfig(graph) });
  }

  const jobs: PendingWebhookJob[] = [];

  for (const result of input.results) {
    if (!result.triggerEvent) continue;
    for (const flow of input.flows) {
      const cached = flowGraphCache.get(flow.id) ?? null;
      if (
        !flowMatchesTriggerResult(flow, result, input.agentSlugsById, cached)
      ) {
        continue;
      }
      if (!flowMatchesTriggerFilter(cached, input, result)) {
        continue;
      }

      jobs.push(createFlowWebhookJob(flow, result, input));
    }
  }

  // Keep the historical parity log shape, but the filter is now the primary
  // routing gate. `flows_id_matched` is the candidate set loaded for the
  // webhook owner(s); `flows_filter_matched` is the subset eligible for this
  // installation/repo/account delivery.
  emitDualReadParityLog(input, flowGraphCache);

  return jobs;
}

function emitDualReadParityLog(
  input: {
    flows: WebhookFlowRow[];
    deliveryId: string | null;
    repoFullName: string | null;
    installationId?: number | null;
    accountType?: TriggerFilterAccountType;
  },
  flowGraphCache: Map<string, FlowGraphCacheEntry | null>
) {
  if (input.flows.length === 0) return;
  if (input.installationId == null || input.accountType == null) {
    // Surface coverage gaps explicitly: silent no-ops would let the 48h grep
    // under-count without warning. Should never fire on the real call path,
    // but if a future refactor drops the field, ops will see it immediately.
    console.warn(
      JSON.stringify({
        event: "flow_routing_dual_read_skipped",
        delivery_id: input.deliveryId,
        repo_full_name: input.repoFullName,
        flows_id_matched: input.flows.length,
        reason: "missing_installation_or_account_type",
        installation_id_present: input.installationId != null,
        account_type_present: input.accountType != null,
      })
    );
    return;
  }

  // No author context here: this log is per-delivery while authors are
  // per-result, so authorFilter modes degrade (exclusion modes count as
  // matched, dependabot_only as not matched). flows_filter_matched can
  // therefore over/under-count flows that use authorFilter; the real routing
  // gate above evaluates per-result with the author included.
  const ctx = {
    installationId: input.installationId,
    repoFullName: input.repoFullName,
    accountType: input.accountType,
  };

  let filterMatched = 0;
  let noFilter = 0;
  const diffFlowIds: string[] = [];

  for (const flow of input.flows) {
    const cached = flowGraphCache.get(flow.id) ?? null;
    if (!cached) {
      // Cannot evaluate without a graph; treat as match (parity with the
      // current code path which would also drop it elsewhere).
      filterMatched += 1;
      continue;
    }
    const filter = cached.start?.filter;
    if (!filter) noFilter += 1;
    if (evaluateTriggerFilter(filter, ctx)) {
      filterMatched += 1;
    } else {
      diffFlowIds.push(flow.id);
    }
  }

  // It is not jobs enqueued: the trigger-event check in
  // flowMatchesTriggerResult is orthogonal and still narrows further.
  // Expect flows_id_matched >= jobs.length for a given delivery.
  console.log(
    JSON.stringify({
      event: "flow_routing_dual_read",
      delivery_id: input.deliveryId,
      installation_id: input.installationId,
      account_type: input.accountType,
      repo_full_name: input.repoFullName,
      flows_id_matched: input.flows.length,
      flows_filter_matched: filterMatched,
      flows_no_filter: noFilter,
      diff_flow_ids: diffFlowIds,
    })
  );
}

function uniqueWebhookUserIds(rows: Array<{ user_id?: string | null }>) {
  return [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
}

function summarizeReasons(items: Array<{ reason: string | null | undefined }>) {
  return items.reduce<Record<string, number>>((acc, item) => {
    if (!item.reason) return acc;
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});
}

// Emits the `labeled` trigger result for `pull_request.labeled` and
// `issues.labeled` deliveries. Deliberately skips the draft/bot-synchronize
// guards used by the PR lifecycle actions: applying a label is an explicit
// request, so labeling a draft PR still fires. The one sender we skip is our
// own GitHub App — a flow whose agent applies labels with the installation
// token must not re-trigger label flows in a loop. (Third-party bots like
// dependabot remain valid senders: "labeled: dependencies" is a real use
// case.)
export function handleLabeledAction(
  body: Record<string, unknown>,
  isPullRequest: boolean
): EventResult[] {
  const labelRecord =
    body.label && typeof body.label === "object"
      ? (body.label as Record<string, unknown>)
      : null;
  const labelName =
    typeof labelRecord?.name === "string" ? labelRecord.name : null;
  if (!labelName) return [];

  const sender = body.sender as { login?: string; type?: string } | undefined;
  if (sender?.login === BOT_LOGIN) return [];

  if (isPullRequest) {
    const pr = body.pull_request as {
      number: number;
      html_url: string;
      title?: string;
      user?: { login?: string; type?: string };
      head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
      base?: { ref?: string; sha?: string; repo?: { full_name?: string } };
    };
    return [
      {
        assignmentType: "labeled",
        triggerEvent: "labeled",
        metadata: {
          ...buildPullRequestMetadata(pr),
          // PR labels also populate the issue_* fields so downstream comment
          // and thread tooling resolves the target the same way it does for
          // `issue_comment` deliveries (`is_pr` + `issue_number`).
          issue_number: pr.number,
          issue_title: pr.title ?? null,
          issue_url: pr.html_url,
          is_pr: true,
          label_name: labelName,
          sender_login: sender?.login ?? null,
        },
        authorLogin: sender?.login ?? null,
        authorIsBot: sender?.type === "Bot",
      },
    ];
  }

  const issue = body.issue as {
    number: number;
    html_url: string;
    title: string;
  };
  return [
    {
      assignmentType: "labeled",
      triggerEvent: "labeled",
      metadata: {
        issue_number: issue.number,
        issue_url: issue.html_url,
        issue_title: issue.title,
        is_pr: false,
        label_name: labelName,
        sender_login: sender?.login ?? null,
      },
      authorLogin: sender?.login ?? null,
      authorIsBot: sender?.type === "Bot",
    },
  ];
}

export function handlePullRequest(
  body: Record<string, unknown>
): EventResult[] {
  const action = body.action as string;
  if (action === "labeled") {
    return handleLabeledAction(body, true);
  }
  if (!isPullRequestTriggerAction(action)) {
    return [];
  }

  if (isBotSynchronizePullRequest(body, action)) {
    return [];
  }

  const pr = body.pull_request as {
    number: number;
    html_url: string;
    title?: string;
    draft?: boolean;
    user?: { login?: string; type?: string };
    head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
    base?: { ref?: string; sha?: string; repo?: { full_name?: string } };
  };
  if (shouldSkipDraftPullRequest(pr, action)) {
    return [];
  }

  return [
    {
      assignmentType: "pr_review",
      triggerEvent: "pr_opened",
      metadata: buildPullRequestMetadata(pr),
      authorLogin: pr.user?.login ?? null,
      authorIsBot: pr.user?.type === "Bot",
    },
  ];
}

// Tag pushes start `tag_push` flows. Deleted tags are skipped (removing a tag
// is not a release signal), and our own GitHub App sender is skipped for
// parity with the labeled trigger's loop guard. Tags created through the
// releases UI/API also arrive as push deliveries for the tag ref, so this
// covers both `git push --tags` and published releases.
export function handleTagPush(
  body: Record<string, unknown>,
  ref: string
): EventResult[] {
  if (body.deleted === true) return [];

  const tagName = ref.slice("refs/tags/".length);
  if (!tagName) return [];

  const sender = body.sender as { login?: string; type?: string } | undefined;
  if (sender?.login === BOT_LOGIN) return [];

  const headCommit = body.head_commit as { id: string } | null;

  return [
    {
      assignmentType: "tag_push",
      triggerEvent: "tag_push",
      metadata: {
        tag_name: tagName,
        ref,
        head_sha: headCommit?.id ?? (body.after as string),
        compare_url: body.compare as string,
        sender_login: sender?.login ?? null,
      },
      authorLogin: sender?.login ?? null,
      authorIsBot: sender?.type === "Bot",
    },
  ];
}

function handlePush(body: Record<string, unknown>): EventResult[] {
  const ref = body.ref as string;
  if (typeof ref === "string" && ref.startsWith("refs/tags/")) {
    return handleTagPush(body, ref);
  }

  const defaultRef = `refs/heads/${(body.repository as { default_branch: string }).default_branch}`;
  if (ref !== defaultRef) return [];

  const commits = body.commits as unknown[];
  const headCommit = body.head_commit as { id: string } | null;

  return [
    {
      assignmentType: "push_review",
      triggerEvent: "push",
      metadata: {
        head_sha: headCommit?.id ?? (body.after as string),
        commits_count: commits?.length ?? 0,
        compare_url: body.compare as string,
      },
    },
  ];
}

function handleIssues(body: Record<string, unknown>): EventResult[] {
  const action = body.action as string;
  if (action === "labeled") {
    return handleLabeledAction(body, false);
  }
  if (!["opened", "reopened"].includes(action)) return [];

  const issue = body.issue as {
    number: number;
    html_url: string;
    title: string;
  };
  return [
    {
      assignmentType: "issue_triage",
      triggerEvent: "issue_opened",
      metadata: {
        issue_number: issue.number,
        issue_url: issue.html_url,
        issue_title: issue.title,
      },
    },
  ];
}

export function handleCIEvent(
  event: string,
  body: Record<string, unknown>
): EventResult[] {
  if (event === "check_run") {
    const checkRun = body.check_run as {
      conclusion: string | null;
      name: string;
      head_sha: string;
      details_url: string;
      check_suite?: { head_branch?: string | null };
    };
    if (isMogplexPrReviewCheckName(checkRun.name)) return [];
    if (body.action !== "completed" || checkRun.conclusion !== "failure")
      return [];

    return [
      {
        assignmentType: "ci_failure",
        triggerEvent: "ci_failure",
        metadata: {
          check_name: checkRun.name,
          head_sha: checkRun.head_sha,
          details_url: checkRun.details_url,
          // The branch the failing commit was pushed to. Reverts must target
          // this branch, not the repo default — CI failures fire for any ref.
          head_branch: checkRun.check_suite?.head_branch ?? null,
        },
      },
    ];
  }

  if (event === "workflow_run") {
    const run = body.workflow_run as {
      conclusion: string | null;
      name: string;
      head_sha: string;
      html_url: string;
      id: number;
      head_branch?: string | null;
    };
    if (body.action !== "completed" || run.conclusion !== "failure") return [];

    return [
      {
        assignmentType: "ci_failure",
        triggerEvent: "ci_failure",
        metadata: {
          workflow_name: run.name,
          head_sha: run.head_sha,
          html_url: run.html_url,
          run_id: run.id,
          head_branch: run.head_branch ?? null,
        },
      },
    ];
  }

  return [];
}

export function handleIssueComment(
  body: Record<string, unknown>
): EventResult[] {
  if (body.action !== "created") return [];

  const comment = body.comment as {
    id: number;
    body: string;
    html_url: string;
    user: { login: string; type: string };
  };

  // Self-loop prevention: skip our own output. The `type === "Bot"` / BOT_LOGIN
  // checks catch comments posted as the App. Agent comments are posted with the
  // connected user's token (arriving as a regular `User`), so we also skip any
  // comment carrying our automation marker — otherwise an "@mogplex" the model
  // writes in its reply re-triggers the mention flow. A human typing "@mogplex"
  // has no marker and still triggers normally.
  if (
    comment.user.type === "Bot" ||
    comment.user.login === BOT_LOGIN ||
    isMogplexAuthoredComment(comment.body)
  )
    return [];

  const issue = body.issue as {
    number: number;
    html_url: string;
    title: string;
    pull_request?: unknown;
  };

  const isPr = Boolean(issue.pull_request);
  const { hasMention, slugs } = parseMentions(comment.body || "");

  const commentMeta = {
    comment_id: comment.id,
    comment_body: (comment.body || "").slice(0, 4096),
    comment_url: comment.html_url,
    comment_author: comment.user.login,
    issue_number: issue.number,
    issue_title: issue.title,
    is_pr: isPr,
  };

  if (hasMention) {
    if (slugs.length > 0) {
      return slugs.map((slug) => ({
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: slug,
      }));
    }
    return [
      {
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: null,
      },
    ];
  }

  return [
    {
      assignmentType: isPr ? "pr_comment" : "issue_comment",
      triggerEvent: (isPr ? "pr_comment" : "issue_comment") as TriggerEvent,
      metadata: commentMeta,
    },
  ];
}

export function handlePRReviewComment(
  body: Record<string, unknown>
): EventResult[] {
  if (body.action !== "created") return [];

  const comment = body.comment as {
    id: number;
    body: string;
    html_url: string;
    user: { login: string; type: string };
  };

  // Self-loop prevention — see handleIssueComment for the rationale.
  if (
    comment.user.type === "Bot" ||
    comment.user.login === BOT_LOGIN ||
    isMogplexAuthoredComment(comment.body)
  )
    return [];

  const pr = body.pull_request as {
    number: number;
    html_url: string;
    title: string;
  };
  const { hasMention, slugs } = parseMentions(comment.body || "");

  const commentMeta = {
    comment_id: comment.id,
    comment_body: (comment.body || "").slice(0, 4096),
    comment_url: comment.html_url,
    comment_author: comment.user.login,
    issue_number: pr.number,
    issue_title: pr.title,
    is_pr: true,
  };

  if (hasMention) {
    if (slugs.length > 0) {
      return slugs.map((slug) => ({
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: slug,
      }));
    }
    return [
      {
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: null,
      },
    ];
  }

  return [
    {
      assignmentType: "pr_comment",
      triggerEvent: "pr_comment" as TriggerEvent,
      metadata: commentMeta,
    },
  ];
}

export function handleCommitComment(
  body: Record<string, unknown>
): EventResult[] {
  if (body.action !== "created") return [];

  const comment = body.comment as {
    id: number;
    body: string;
    html_url: string;
    user: { login: string; type: string };
    commit_id: string;
  };

  // Self-loop prevention — see handleIssueComment. `ci-tools` posts commit
  // comments with the connected user's token (arriving as a `User`), so the
  // marker check is required here too, not just the Bot guard.
  if (
    comment.user.type === "Bot" ||
    comment.user.login === BOT_LOGIN ||
    isMogplexAuthoredComment(comment.body)
  )
    return [];

  const { hasMention, slugs } = parseMentions(comment.body || "");

  const commentMeta = {
    comment_id: comment.id,
    comment_body: (comment.body || "").slice(0, 4096),
    comment_url: comment.html_url,
    comment_author: comment.user.login,
    commit_id: comment.commit_id,
    is_pr: false,
  };

  if (hasMention) {
    if (slugs.length > 0) {
      return slugs.map((slug) => ({
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: slug,
      }));
    }
    return [
      {
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: null,
      },
    ];
  }

  // Commit comments without mentions don't map to a standard trigger
  return [];
}

const eventHandlers: Record<
  string,
  (body: Record<string, unknown>, event: string) => EventResult[]
> = {
  pull_request: (body) => handlePullRequest(body),
  push: (body) => handlePush(body),
  issues: (body) => handleIssues(body),
  check_run: (body, event) => handleCIEvent(event, body),
  workflow_run: (body, event) => handleCIEvent(event, body),
  issue_comment: (body) => handleIssueComment(body),
  pull_request_review_comment: (body) => handlePRReviewComment(body),
  commit_comment: (body) => handleCommitComment(body),
};

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
  // Prefer target_type (canonical on the installation) and fall back to the
  // nested account.type. Both are literal "User"/"Organization" strings in
  // practice; normalizeAccountType defaults anything else to "User".
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
): Promise<WebhookRequestContext> {
  const body = JSON.parse(context.payload) as WebhookPayloadBody;

  return Promise.resolve({
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
  });
}

function validateGlobalWebhookSignature(context: RawWebhookRequestContext) {
  if (!context.globalSecret) {
    return null;
  }

  return verifySignature(
    context.payload,
    context.signature,
    context.globalSecret
  )
    ? null
    : buildInvalidSignatureResponse();
}

async function loadWebhookRepoRows(
  repoGithubId: number | null,
  installationId: number | null
) {
  if (!repoGithubId) {
    return [];
  }

  let repoQuery = supabaseAdmin
    .from("repos")
    .select("*")
    .eq("github_id", repoGithubId);

  if (installationId) {
    repoQuery = repoQuery.eq("github_installation_id", installationId);
  }

  const { data } = await repoQuery;
  return (data || []) as WebhookRepoRow[];
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

  if (repoRows.length === 0) {
    return buildSkippedWebhookResponse();
  }

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

function getWebhookEventResults(
  event: string | null,
  body: Record<string, unknown>
) {
  const handler = event ? eventHandlers[event] : null;
  if (!handler || !event) {
    return [];
  }

  return handler(body, event);
}

function collectFlowAgentIds(flows: WebhookFlowRow[]) {
  return Array.from(
    new Set(
      flows.flatMap((flow) => {
        const publishedVersion = getPublishedFlowVersion(flow);
        if (!publishedVersion) {
          return [];
        }

        return getEntryAgentIds(coerceGraph(publishedVersion.graph));
      })
    )
  );
}

async function loadFlowAgentSlugMap(
  agentIds: string[],
  installationId: number
) {
  const { data: agents, error } =
    agentIds.length > 0
      ? await supabaseAdmin.from("agents").select("id, slug").in("id", agentIds)
      : { data: [], error: null };

  if (error) {
    console.error("Failed to load flow routing agents:", {
      installationId,
      error: error.message,
    });
    return NextResponse.json(
      { error: "Failed to load flow agents" },
      { status: 500 }
    );
  }

  return new Map(
    (agents || []).map((agent) => [
      agent.id as string,
      (agent.slug as string | null) ?? null,
    ])
  );
}

async function loadWebhookFlowUserIds(input: {
  repoRows: WebhookRepoRow[];
  installationId: number | null;
}) {
  const repoUserIds = uniqueWebhookUserIds(input.repoRows);
  if (repoUserIds.length > 0) {
    return repoUserIds;
  }

  if (!input.installationId) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("github_installations")
    .select("user_id")
    .eq("installation_id", input.installationId);

  if (error) {
    console.error("Failed to load flow routing users:", {
      installationId: input.installationId,
      error: error.message,
    });
    return NextResponse.json(
      { error: "Failed to load flow routing users" },
      { status: 500 }
    );
  }

  return uniqueWebhookUserIds(data || []);
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
  if (!input.installationId) {
    return [];
  }

  const triggerEvents = new Set(
    input.results
      .map((result) => result.triggerEvent)
      .filter(Boolean) as TriggerEvent[]
  );
  if (triggerEvents.size === 0) {
    return [];
  }

  const userIds = await loadWebhookFlowUserIds({
    repoRows: input.repoRows,
    installationId: input.installationId,
  });
  if (userIds instanceof Response) {
    return userIds;
  }
  if (userIds.length === 0) {
    return [];
  }

  const { data: flows, error } = await supabaseAdmin
    .from("flows")
    .select(
      "id, user_id, installation_id, published_version_id, published_version:flow_versions!flows_published_version_id_fkey(id, graph)"
    )
    .in("user_id", userIds)
    .eq("status", "active")
    .not("published_version_id", "is", null);

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

  const typedFlows = (flows || []) as WebhookFlowRow[];
  if (typedFlows.length === 0) {
    return [];
  }

  const agentSlugsById = await loadFlowAgentSlugMap(
    collectFlowAgentIds(typedFlows),
    input.installationId
  );
  if (agentSlugsById instanceof Response) {
    return agentSlugsById;
  }

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

async function buildWebhookJobs(input: {
  context: WebhookRequestContext;
  repoRows: WebhookRepoRow[];
  results: EventResult[];
}) {
  return loadFlowWebhookJobs({
    installationId: input.context.installationId,
    results: input.results,
    repoRows: input.repoRows,
    payload: input.context.payload,
    deliveryId: input.context.deliveryId,
    repoFullName: input.context.repoFullName,
    accountType: input.context.accountType,
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

type MentionLoopTarget = {
  key: string;
  repoId: string;
  issueNumber: number;
};

/**
 * The (repo, issue) a mention job loops on, or null when the job is not a
 * capped mention. Single source of truth for which jobs count toward
 * MENTION_LOOP_MAX, so the in-batch sibling count and the DB snapshot agree.
 */
function mentionLoopTarget(job: PendingWebhookJob): MentionLoopTarget | null {
  if (job.scope.sourceType !== "mention" || !job.scope.repoId) return null;
  const issueNumber = Number(
    (job.metadata as { issue_number?: unknown })?.issue_number
  );
  if (!Number.isInteger(issueNumber)) return null;
  return {
    key: `${job.scope.repoId}#${issueNumber}`,
    repoId: job.scope.repoId,
    issueNumber,
  };
}

/**
 * For each job in a batch, how many earlier jobs in the same batch share its
 * mention-loop key. Lets a single fan-out delivery count its own siblings
 * toward MENTION_LOOP_MAX instead of each job racing the same pre-batch count.
 */
export function countInBatchMentionSiblings(
  jobs: PendingWebhookJob[]
): number[] {
  const seen = new Map<string, number>();
  return jobs.map((job) => {
    const key = mentionLoopTarget(job)?.key;
    if (!key) return 0;
    const prior = seen.get(key) ?? 0;
    seen.set(key, prior + 1);
    return prior;
  });
}

/**
 * Decide, for every job in a single webhook delivery, whether the mention
 * loop-breaker should suppress it. Returns a parallel boolean array.
 *
 * The recent-enqueue count is snapshotted ONCE per loop key BEFORE any job in
 * the batch enqueues. Counting per-job during the batch would race the batch's
 * own INSERTs — a later sibling's SELECT could already observe an earlier
 * sibling's queued row, then double-count it against the in-batch tally and
 * suppress a job the cap should allow. Snapshotting up front makes
 * `snapshot + in-batch siblings` exact for the delivery.
 *
 * Fails open per key (treats it as not tripped) when the count query errors, so
 * a transient DB issue never blocks a legitimate mention.
 */
export async function evaluateMentionLoopBreaker(
  jobs: PendingWebhookJob[],
  countMentions: typeof countRecentMentionEnqueues = countRecentMentionEnqueues
): Promise<boolean[]> {
  const siblings = countInBatchMentionSiblings(jobs);

  const firstTargetByKey = new Map<string, MentionLoopTarget>();
  for (const job of jobs) {
    const target = mentionLoopTarget(job);
    if (target && !firstTargetByKey.has(target.key)) {
      firstTargetByKey.set(target.key, target);
    }
  }

  const snapshot = new Map<string, number>();
  await Promise.all(
    [...firstTargetByKey.values()].map(async (target) => {
      try {
        snapshot.set(
          target.key,
          await countMentions({
            repoId: target.repoId,
            issueNumber: target.issueNumber,
            sinceMinutes: MENTION_LOOP_WINDOW_MINUTES,
          })
        );
      } catch (error) {
        // Fail open: leave the key unset so its jobs are never suppressed.
        console.error("Mention loop-breaker count failed:", error);
      }
    })
  );

  return jobs.map((job, index) => {
    const key = mentionLoopTarget(job)?.key;
    if (!key) return false;
    const recent = snapshot.get(key);
    if (recent === undefined) return false;
    return recent + siblings[index] >= MENTION_LOOP_MAX;
  });
}

async function suppressMentionLoopJob(
  job: PendingWebhookJob
): Promise<EnqueuedWebhookJob> {
  await logAutomationDispatchEvent({
    userId: job.userId,
    flowId: job.flow_id ?? null,
    flowVersionId: job.flow_version_id ?? null,
    repoId: job.scope.repoId,
    installationId: job.scope.installationId,
    sourceKind: job.scope.sourceKind,
    sourceType: job.scope.sourceType,
    eventKind: "enqueue",
    outcome: "suppressed",
    reason: "MENTION_LOOP_BREAKER",
    metadata: job.metadata,
  }).catch((error) => {
    console.error("Failed to log MENTION_LOOP_BREAKER suppression:", error);
  });

  return {
    jobRunId: null,
    outcome: "suppressed",
    reason: "MENTION_LOOP_BREAKER",
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
  return startWebhookJobRun(job.jobRunId!, "webhook");
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

export async function POST(request: Request) {
  const rawContext = await parseWebhookRequest(request);
  const globalSignatureResponse = validateGlobalWebhookSignature(rawContext);
  if (globalSignatureResponse) {
    return globalSignatureResponse;
  }

  const context = await parseWebhookRequestBody(rawContext);
  const repoRows = await loadWebhookRepoRows(
    context.repoGithubId,
    context.installationId
  );

  const signatureResponse = validateWebhookSignature(context, repoRows);
  if (signatureResponse) {
    return signatureResponse;
  }

  const syncResult = await syncWebhookStateOrResponse(context);
  if (syncResult instanceof Response) {
    return syncResult;
  }

  const checkRunRetryResponse = await buildCheckRunRetryResponse({
    context,
    repoRows,
    sync: syncResult,
  });
  if (checkRunRetryResponse) {
    return checkRunRetryResponse;
  }

  // Resume any await_event waits keyed off this delivery before enqueuing new
  // automation jobs. The two paths are independent — one delivery can both
  // resume a wait and start a new flow run if the user has wired both — so we
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

  const jobs = await buildWebhookJobs({
    context,
    repoRows,
    results,
  });
  if (jobs instanceof Response) {
    return jobs;
  }
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
