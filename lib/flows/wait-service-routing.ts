/**
 * GitHub event routing to flow waits.
 *
 * This module handles matching inbound webhook events (labels, comments, CI
 * completions, Vercel previews) to active flow waits and resuming them via
 * the CAS-based resumeFlowWait function.
 */
import type { FlowStartFilter } from "@/lib/types";
import {
  evaluateTriggerFilter,
  type TriggerFilterAccountType,
} from "./trigger-filter";
import {
  findActiveFlowWaitsForEvent,
  loadStartFiltersForFlowIds,
  resumeFlowWait,
  type ResumeFlowWaitCandidate,
} from "./wait-service-core";

export type GithubLabeledEvent = {
  installationId: number | null;
  repoId: string | null;
  repoFullName: string | null;
  accountType: TriggerFilterAccountType;
  labelName: string;
  isPullRequest: boolean;
  deliveryId: string | null;
  payload: Record<string, unknown>;
};

export type RouteFlowWaitsOutcome = {
  matched: number;
  resumed: number;
  alreadyResumed: number;
  completeFailed: number;
  failures: string[];
};

export type RouteGithubLabeledOutcome = RouteFlowWaitsOutcome;

async function emitWaitDualReadParityLog(
  event: GithubLabeledEvent,
  matches: Array<{ id: string; flow_id: string }>,
  loadStartFilters: typeof loadStartFiltersForFlowIds
) {
  if (matches.length === 0) return;
  if (event.installationId == null) {
    // Surface coverage gaps explicitly: silent no-ops would let the 48h grep
    // under-count without warning. Should never fire on the real path
    // (findActiveFlowWaitsForEvent already returns [] for null installations),
    // but if a future refactor changes that, ops will see it immediately.
    console.warn(
      JSON.stringify({
        event: "wait_routing_dual_read_skipped",
        delivery_id: event.deliveryId,
        repo_full_name: event.repoFullName,
        label_name: event.labelName,
        waits_id_matched: matches.length,
        reason: "missing_installation_id",
      })
    );
    return;
  }

  const flowIds = Array.from(new Set(matches.map((m) => m.flow_id)));
  let filtersByFlowId: Map<string, FlowStartFilter | undefined>;
  try {
    filtersByFlowId = await loadStartFilters(flowIds);
  } catch (error) {
    // Never let dual-read instrumentation interfere with resume routing.
    console.warn(
      JSON.stringify({
        event: "wait_routing_dual_read_lookup_failed",
        delivery_id: event.deliveryId,
        installation_id: event.installationId,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return;
  }

  // Label events carry no PR-author context, so authorFilter modes degrade
  // here: exclusion modes count as matched, dependabot_only as not matched.
  // Fine while this is shadow-only, but if Phase 3 makes the filter gate
  // resumes, dependabot_only flows would need author context plumbed through
  // (or authorFilter exempted from resume routing) to avoid blocking their
  // own waits.
  const ctx = {
    installationId: event.installationId,
    repoFullName: event.repoFullName,
    accountType: event.accountType,
  };

  let filterMatched = 0;
  let noFilter = 0;
  const diffWaitIds: string[] = [];

  for (const match of matches) {
    const filter = filtersByFlowId.get(match.flow_id);
    if (!filter) noFilter += 1;
    if (evaluateTriggerFilter(filter, ctx)) {
      filterMatched += 1;
    } else {
      diffWaitIds.push(match.id);
    }
  }

  console.log(
    JSON.stringify({
      event: "wait_routing_dual_read",
      delivery_id: event.deliveryId,
      installation_id: event.installationId,
      account_type: event.accountType,
      repo_full_name: event.repoFullName,
      label_name: event.labelName,
      waits_id_matched: matches.length,
      waits_filter_matched: filterMatched,
      waits_no_filter: noFilter,
      diff_wait_ids: diffWaitIds,
    })
  );
}

export async function routeGithubLabeledEventToFlowWaits(
  event: GithubLabeledEvent,
  deps: {
    findCandidates?: typeof findActiveFlowWaitsForEvent;
    resumeWait?: typeof resumeFlowWait;
    loadStartFilters?: typeof loadStartFiltersForFlowIds;
  } = {}
): Promise<RouteGithubLabeledOutcome> {
  const findCandidates = deps.findCandidates ?? findActiveFlowWaitsForEvent;
  const resumeWait = deps.resumeWait ?? resumeFlowWait;
  const loadStartFilters = deps.loadStartFilters ?? loadStartFiltersForFlowIds;

  const candidates = await findCandidates({
    installationId: event.installationId,
    waitKind: "github_label_added",
    repoId: event.repoId,
  });

  const matches = candidates.filter((candidate) => {
    if (candidate.wait_config.kind !== "github_label_added") return false;
    if (candidate.wait_config.labelName !== event.labelName) return false;
    if (candidate.wait_config.prOnly && !event.isPullRequest) return false;
    return true;
  });

  // Phase 2 shadow read: evaluate the parent flow's start.filter against this
  // delivery so we can confirm parity in prod for >=48h before Phase 3 flips
  // routing to the filter as primary. Does NOT gate resumes — every match
  // continues to the CAS as before.
  await emitWaitDualReadParityLog(event, matches, loadStartFilters);

  let resumed = 0;
  let alreadyResumed = 0;
  let completeFailed = 0;
  const failures: string[] = [];

  for (const candidate of matches) {
    try {
      const outcome = await resumeWait({
        candidate,
        payload: event.payload,
        deliveryId: event.deliveryId,
      });
      if (outcome.resumed) {
        resumed += 1;
      } else if (outcome.reason === "already_resumed") {
        alreadyResumed += 1;
      } else {
        completeFailed += 1;
        if (outcome.message) failures.push(outcome.message);
      }
    } catch (error) {
      completeFailed += 1;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    matched: matches.length,
    resumed,
    alreadyResumed,
    completeFailed,
    failures,
  };
}

export type GithubCommentAddedEvent = {
  installationId: number | null;
  repoId: string | null;
  issueNumber: number;
  isPullRequest: boolean;
  authorLogin: string;
  body: string;
  deliveryId: string | null;
  payload: Record<string, unknown>;
};

function sameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

async function resumeMatchingFlowWaits(input: {
  matches: ResumeFlowWaitCandidate[];
  payload: Record<string, unknown>;
  deliveryId: string | null;
  resumeWait: typeof resumeFlowWait;
}): Promise<RouteFlowWaitsOutcome> {
  let resumed = 0;
  let alreadyResumed = 0;
  let completeFailed = 0;
  const failures: string[] = [];

  for (const candidate of input.matches) {
    try {
      const outcome = await input.resumeWait({
        candidate,
        payload: input.payload,
        deliveryId: input.deliveryId,
      });
      if (outcome.resumed) {
        resumed += 1;
      } else if (outcome.reason === "already_resumed") {
        alreadyResumed += 1;
      } else {
        completeFailed += 1;
        if (outcome.message) failures.push(outcome.message);
      }
    } catch (error) {
      completeFailed += 1;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    matched: input.matches.length,
    resumed,
    alreadyResumed,
    completeFailed,
    failures,
  };
}

export async function routeGithubCommentAddedEventToFlowWaits(
  event: GithubCommentAddedEvent,
  deps: {
    findCandidates?: typeof findActiveFlowWaitsForEvent;
    resumeWait?: typeof resumeFlowWait;
  } = {}
): Promise<RouteFlowWaitsOutcome> {
  const findCandidates = deps.findCandidates ?? findActiveFlowWaitsForEvent;
  const resumeWait = deps.resumeWait ?? resumeFlowWait;
  const candidates = await findCandidates({
    installationId: event.installationId,
    waitKind: "github_comment_added",
    repoId: event.repoId,
  });
  const normalizedBody = event.body.toLowerCase();
  const matches = candidates.filter((candidate) => {
    const config = candidate.wait_config;
    if (config.kind !== "github_comment_added") return false;
    if (
      config.expectedIssueNumber != null &&
      config.expectedIssueNumber !== event.issueNumber
    ) {
      return false;
    }
    if (config.prOnly && !event.isPullRequest) return false;
    if (
      config.authorLogin.trim() &&
      !sameName(config.authorLogin, event.authorLogin)
    ) {
      return false;
    }
    const bodyContains = config.bodyContains.trim().toLowerCase();
    return !bodyContains || normalizedBody.includes(bodyContains);
  });

  return resumeMatchingFlowWaits({
    matches,
    payload: event.payload,
    deliveryId: event.deliveryId,
    resumeWait,
  });
}

function sameOptionalSha(expectedSha: string | null | undefined, sha: string) {
  const expected = expectedSha?.trim();
  return !expected || expected.toLowerCase() === sha.trim().toLowerCase();
}

export type GithubCiCompletedEvent = {
  installationId: number | null;
  repoId: string | null;
  workflowName: string;
  conclusion: string | null;
  headSha: string;
  deliveryId: string | null;
  payload: Record<string, unknown>;
};

export async function routeGithubCiCompletedEventToFlowWaits(
  event: GithubCiCompletedEvent,
  deps: {
    findCandidates?: typeof findActiveFlowWaitsForEvent;
    resumeWait?: typeof resumeFlowWait;
  } = {}
): Promise<RouteFlowWaitsOutcome> {
  const findCandidates = deps.findCandidates ?? findActiveFlowWaitsForEvent;
  const resumeWait = deps.resumeWait ?? resumeFlowWait;
  const candidates = await findCandidates({
    installationId: event.installationId,
    waitKind: "ci_workflow_completed",
    repoId: event.repoId,
  });
  const matches = candidates.filter((candidate) => {
    const config = candidate.wait_config;
    if (config.kind !== "ci_workflow_completed") return false;
    if (!sameName(config.workflowName, event.workflowName)) return false;
    if (config.conclusion !== "any" && config.conclusion !== event.conclusion) {
      return false;
    }
    return sameOptionalSha(config.expectedSha, event.headSha);
  });

  return resumeMatchingFlowWaits({
    matches,
    payload: event.payload,
    deliveryId: event.deliveryId,
    resumeWait,
  });
}

export type GithubVercelPreviewReadyEvent = {
  installationId: number | null;
  repoId: string | null;
  environment: string;
  sha: string;
  deliveryId: string | null;
  payload: Record<string, unknown>;
};

export async function routeGithubVercelPreviewReadyEventToFlowWaits(
  event: GithubVercelPreviewReadyEvent,
  deps: {
    findCandidates?: typeof findActiveFlowWaitsForEvent;
    resumeWait?: typeof resumeFlowWait;
  } = {}
): Promise<RouteFlowWaitsOutcome> {
  const findCandidates = deps.findCandidates ?? findActiveFlowWaitsForEvent;
  const resumeWait = deps.resumeWait ?? resumeFlowWait;
  const candidates = await findCandidates({
    installationId: event.installationId,
    waitKind: "vercel_preview_ready",
    repoId: event.repoId,
  });
  const matches = candidates.filter((candidate) => {
    const config = candidate.wait_config;
    if (config.kind !== "vercel_preview_ready") return false;
    if (!sameName(config.environment, event.environment)) return false;
    return sameOptionalSha(config.expectedSha, event.sha);
  });

  return resumeMatchingFlowWaits({
    matches,
    payload: event.payload,
    deliveryId: event.deliveryId,
    resumeWait,
  });
}
