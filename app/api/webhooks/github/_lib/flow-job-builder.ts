import crypto from "node:crypto";
import { buildPrReviewHeadShaDedupKey } from "@/lib/automation-review";
import {
  coerceGraph,
  getEntryAgentIds,
  getStartConfig,
} from "@/lib/flows/graph";
import { evaluateTriggerFilter } from "@/lib/flows/trigger-filter";
import type { TriggerFilterAccountType } from "@/lib/flows/trigger-filter";
import type {
  EventResult,
  PendingWebhookJob,
  WebhookFlowRow,
  WebhookRepoRow,
} from "./types";

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

export function getPublishedFlowVersion(flow: WebhookFlowRow) {
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
// An empty/absent start labelName matches any label - consistent with the
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
// else is literal. An empty/absent pattern matches any tag - consistent with
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
  // a hot path; without this cache an installation with N flows x M trigger
  // results would re-coerce the same JSONB NxM times, then the log pass would
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

export function collectFlowAgentIds(flows: WebhookFlowRow[]) {
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
