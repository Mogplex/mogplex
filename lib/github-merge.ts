import {
  withAgentMergePolicy,
  type AgentMergePolicyScope,
} from "./github-merge-agent-policy";
import { githubHeaders } from "./github-headers";

export { githubHeaders } from "./github-headers";

export type AutoMergeOutcome = {
  merged: boolean;
  queued?: boolean;
  reason: string;
  sha?: string | null;
  approvalId?: string;
};

type PullRequestGate = {
  state?: string;
  draft?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  node_id?: string;
  head?: { sha?: string };
  base?: { ref?: string };
};

type MergeInput = {
  githubToken: string;
  owner: string;
  repo: string;
  prNumber: number;
  // When set, refuse to merge if the PR head no longer matches this SHA —
  // commits pushed after the review were never reviewed.
  expectedHeadSha?: string;
  commitTitle?: string;
  fetchImpl?: typeof fetch;
  mergePolicyScope?: AgentMergePolicyScope;
  requireImmediateMerge?: boolean;
};

async function loadPullRequestGate(
  input: MergeInput
): Promise<PullRequestGate> {
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.prNumber}`,
    { headers: githubHeaders(input.githubToken) }
  );
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: PR #${input.prNumber}`);
  }
  return (await res.json()) as PullRequestGate;
}

type AutoMergeGraphqlPayload = {
  data?: {
    enablePullRequestAutoMerge?: {
      pullRequest?: { autoMergeRequest?: { enabledAt?: string } | null };
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

function autoMergeVariables(input: MergeInput, pr: PullRequestGate) {
  const variables: Record<string, unknown> = {
    pullRequestId: pr.node_id,
    mergeMethod: "SQUASH",
    expectedHeadOid: pr.head?.sha,
  };
  if (input.commitTitle) variables.commitHeadline = input.commitTitle;
  return variables;
}

function readGraphqlErrors(
  payload: { errors?: Array<{ message?: string }> } | null
) {
  if (!payload?.errors) return null;
  const messages = payload.errors.flatMap((error) =>
    error.message?.trim() ? [error.message.trim()] : []
  );
  return messages.length > 0 ? messages.join("; ") : null;
}

function autoMergeGraphqlFailure(input: {
  responseOk: boolean;
  responseStatus: number;
  errorMessage: string | null;
}): AutoMergeOutcome | null {
  if (input.responseOk && !input.errorMessage) return null;
  if (input.errorMessage?.toLowerCase().includes("already enabled")) {
    return {
      merged: false,
      queued: true,
      reason: "GitHub auto-merge was already enabled",
    };
  }
  const details = input.errorMessage
    ? `: ${input.errorMessage.slice(0, 300)}`
    : "";
  return {
    merged: false,
    reason: `GitHub auto-merge failed (${input.responseStatus})${details}`,
  };
}

function autoMergeGraphqlOutcome(input: {
  responseOk: boolean;
  responseStatus: number;
  payload: AutoMergeGraphqlPayload | null;
}): AutoMergeOutcome {
  const failure = autoMergeGraphqlFailure({
    responseOk: input.responseOk,
    responseStatus: input.responseStatus,
    errorMessage: readGraphqlErrors(input.payload),
  });
  if (failure) return failure;
  if (
    !input.payload?.data?.enablePullRequestAutoMerge?.pullRequest
      ?.autoMergeRequest
  ) {
    return {
      merged: false,
      reason: "GitHub did not confirm that auto-merge was enabled",
    };
  }
  return {
    merged: false,
    queued: true,
    reason:
      "GitHub auto-merge enabled; waiting for required checks and branch protection",
  };
}

function addAutoMergeWaitingContext(
  outcome: AutoMergeOutcome,
  pr: PullRequestGate
): AutoMergeOutcome {
  if (!outcome.queued || pr.mergeable_state !== "behind") return outcome;
  return {
    ...outcome,
    reason: `${outcome.reason}. The pull request branch is behind the base branch`,
  };
}

async function enablePullRequestAutoMerge(
  input: MergeInput,
  pr: PullRequestGate
): Promise<AutoMergeOutcome> {
  if (input.requireImmediateMerge) {
    return {
      merged: false,
      reason:
        "Approval covers one exact head for a direct merge. Wait for checks and reviews to pass, then request approval for another attempt. Auto-merge was not enabled.",
    };
  }
  if (!pr.node_id?.trim() || !pr.head?.sha?.trim()) {
    return {
      merged: false,
      reason:
        "GitHub did not return enough pull request data to enable auto-merge",
    };
  }

  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(input.githubToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation EnablePullRequestAutoMerge($input: EnablePullRequestAutoMergeInput!) {
        enablePullRequestAutoMerge(input: $input) {
          pullRequest { autoMergeRequest { enabledAt } }
        }
      }`,
      variables: { input: autoMergeVariables(input, pr) },
    }),
  });
  const payload = (await res
    .json()
    .catch(() => null)) as AutoMergeGraphqlPayload | null;
  return addAutoMergeWaitingContext(
    autoMergeGraphqlOutcome({
      responseOk: res.ok,
      responseStatus: res.status,
      payload,
    }),
    pr
  );
}

function pullRequestBlockReason(
  input: MergeInput,
  pr: PullRequestGate
): AutoMergeOutcome | null {
  if (pr.state !== "open") {
    return { merged: false, reason: `PR is ${pr.state ?? "unknown"}` };
  }
  if (pr.draft === true) return { merged: false, reason: "PR is a draft" };
  if (input.expectedHeadSha && pr.head?.sha !== input.expectedHeadSha) {
    return {
      merged: false,
      reason: `PR head moved since the review (reviewed ${input.expectedHeadSha}, head is now ${pr.head?.sha ?? "unknown"})`,
    };
  }
  if (pr.mergeable === false) {
    return { merged: false, reason: "PR has merge conflicts" };
  }
  return null;
}

const AUTO_MERGE_WAITING_STATES = new Set(["blocked", "behind", "unknown"]);

function shouldEnablePullRequestAutoMerge(pr: PullRequestGate) {
  return (
    pr.mergeable == null ||
    AUTO_MERGE_WAITING_STATES.has(pr.mergeable_state ?? "unknown")
  );
}

async function mergeCleanPullRequest(
  input: MergeInput,
  pr: PullRequestGate
): Promise<AutoMergeOutcome> {
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/merge`,
    {
      method: "PUT",
      headers: {
        ...githubHeaders(input.githubToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        merge_method: "squash",
        ...(input.commitTitle ? { commit_title: input.commitTitle } : {}),
        ...(pr.head?.sha ? { sha: pr.head.sha } : {}),
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      merged: false,
      reason: `GitHub merge failed (${res.status})${body ? `: ${body.slice(0, 300)}` : ""}`,
    };
  }

  const data = (await res.json()) as { sha?: string; merged?: boolean };
  return {
    merged: data.merged === true,
    reason:
      data.merged === true
        ? "Merged after clean review"
        : "GitHub reported not merged",
    sha: data.sha ?? null,
  };
}

const RULES_PAGE_SIZE = 100;

function nextPageUrl(linkHeader: string | null) {
  const next = linkHeader
    ?.split(",")
    .find((part) => part.includes('rel="next"'));
  const start = next?.indexOf("<") ?? -1;
  const end = next?.indexOf(">") ?? -1;
  return next && start >= 0 && end > start ? next.slice(start + 1, end) : null;
}

/**
 * Whether the PR's base branch merges through a merge queue. A ruleset can
 * require one; GitHub then refuses the REST merge endpoint, so the PR has to
 * join the queue instead. The rules list is paginated, so every page is read.
 * A rules lookup that fails keeps the direct path.
 */
async function baseBranchUsesMergeQueue(
  input: MergeInput,
  pr: PullRequestGate
) {
  const baseRef = pr.base?.ref?.trim();
  if (!baseRef) return false;
  const doFetch = input.fetchImpl ?? fetch;
  let url: string | null =
    `https://api.github.com/repos/${input.owner}/${input.repo}/rules/branches/${encodeURIComponent(baseRef)}?per_page=${RULES_PAGE_SIZE}`;
  while (url) {
    const res = await doFetch(url, {
      headers: githubHeaders(input.githubToken),
    }).catch(() => null);
    if (!res?.ok) return false;
    const rules = (await res.json().catch(() => null)) as Array<{
      type?: string;
    }> | null;
    if (!Array.isArray(rules)) return false;
    if (rules.some((rule) => rule?.type === "merge_queue")) return true;
    url = nextPageUrl(res.headers.get("link"));
  }
  return false;
}

type EnqueueGraphqlPayload = {
  data?: {
    enqueuePullRequest?: {
      mergeQueueEntry?: { position?: number | null } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

// A PR that already meets every requirement joins the queue directly; GitHub
// refuses to enable auto-merge on one that is already clean. The entry is
// pinned to the evaluated head, so a later push cannot ride along.
async function enqueuePullRequest(
  input: MergeInput,
  pr: PullRequestGate
): Promise<AutoMergeOutcome> {
  if (!pr.node_id?.trim() || !pr.head?.sha?.trim()) {
    return {
      merged: false,
      reason:
        "GitHub did not return enough pull request data to join the merge queue",
    };
  }
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(input.githubToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation EnqueuePullRequest($input: EnqueuePullRequestInput!) {
        enqueuePullRequest(input: $input) { mergeQueueEntry { position } }
      }`,
      variables: {
        input: { pullRequestId: pr.node_id, expectedHeadOid: pr.head.sha },
      },
    }),
  });
  const payload = (await res
    .json()
    .catch(() => null)) as EnqueueGraphqlPayload | null;
  return enqueueOutcome({ ok: res.ok, status: res.status, payload });
}

function enqueueOutcome(response: {
  ok: boolean;
  status: number;
  payload: EnqueueGraphqlPayload | null;
}): AutoMergeOutcome {
  const { payload } = response;
  const error = readGraphqlErrors(payload);
  if (error?.toLowerCase().includes("already in the queue")) {
    return {
      merged: false,
      queued: true,
      reason:
        "Already in the merge queue; GitHub merges it once the queue's checks pass",
    };
  }
  if (!response.ok || error) {
    return {
      merged: false,
      reason: `GitHub merge queue rejected the pull request (${response.status})${error ? `: ${error.slice(0, 300)}` : ""}`,
    };
  }
  const entry = payload?.data?.enqueuePullRequest?.mergeQueueEntry;
  if (!entry) {
    return {
      merged: false,
      reason:
        "GitHub did not confirm that the pull request joined the merge queue",
    };
  }
  return {
    merged: false,
    queued: true,
    reason: `Added to the merge queue${queuePosition(entry.position)}; GitHub merges it once the queue's checks pass`,
  };
}

function queuePosition(position: number | null | undefined) {
  return typeof position === "number" ? ` at position ${position}` : "";
}

function notCleanReason(pr: PullRequestGate): AutoMergeOutcome {
  const state = pr.mergeable_state ?? "unknown";
  return {
    merged: false,
    reason:
      state === "unstable"
        ? "PR is not clean to merge (state: unstable): a check that is not required is failing or still running. Fix it or wait for it first, or the user can merge on GitHub"
        : `PR is not clean to merge (state: ${state})`,
  };
}

function autoMergeDisallowed(outcome: AutoMergeOutcome) {
  return (
    !outcome.queued && /auto[- ]?merge is not allowed/i.test(outcome.reason)
  );
}

// Repositories can turn auto-merge off and still require a merge queue. The
// queue then is the only way in, so offer the PR to it directly; GitHub
// refuses it until its requirements pass, and that refusal is reported.
async function armQueueMerge(
  input: MergeInput,
  pr: PullRequestGate
): Promise<AutoMergeOutcome> {
  const outcome = await enablePullRequestAutoMerge(input, pr);
  if (!autoMergeDisallowed(outcome)) return outcome;
  const enqueued = await enqueuePullRequest(input, pr);
  if (enqueued.queued) return enqueued;
  return {
    merged: false,
    reason: `Auto-merge is turned off for this repository, so the pull request can only join the merge queue once it is ready. ${enqueued.reason}`,
  };
}

/** Queue-protected branches: join the queue now, or once requirements pass. */
function mergeThroughQueue(
  input: MergeInput,
  pr: PullRequestGate
): Promise<AutoMergeOutcome> | AutoMergeOutcome {
  if (pr.mergeable_state === "clean") return enqueuePullRequest(input, pr);
  if (shouldEnablePullRequestAutoMerge(pr)) return armQueueMerge(input, pr);
  return notCleanReason(pr);
}

// Arm GitHub's native auto-merge without attempting a direct merge. The merge
// then completes on a later webhook-driven state transition (required checks
// green, branch protection satisfied) without polling.
async function queuePullRequestForMergeUnchecked(
  input: MergeInput
): Promise<AutoMergeOutcome> {
  const pr = await loadPullRequestGate(input);
  const blocked = pullRequestBlockReason(input, pr);
  if (blocked) return blocked;
  if (!(await baseBranchUsesMergeQueue(input, pr))) {
    return enablePullRequestAutoMerge(input, pr);
  }
  return pr.mergeable_state === "clean"
    ? enqueuePullRequest(input, pr)
    : armQueueMerge(input, pr);
}

// Merge immediately only when GitHub itself reports the PR as safe: open, not
// a draft, no conflicts, and `mergeable_state === "clean"`. If required checks
// or branch protection are still pending, arm GitHub's native auto-merge so a
// later webhook-driven state transition completes the merge without polling.
// The direct merge pins the reviewed head. Native auto-merge validates that
// head when enabled. GitHub can keep it enabled after later pushes, but still
// enforces required checks and branch protection on the current head.
async function mergePullRequestIfSafeUnchecked(
  input: MergeInput
): Promise<AutoMergeOutcome> {
  const pr = await loadPullRequestGate(input);
  const blocked = pullRequestBlockReason(input, pr);
  if (blocked) return blocked;
  if (await baseBranchUsesMergeQueue(input, pr)) {
    return mergeThroughQueue(input, pr);
  }
  if (shouldEnablePullRequestAutoMerge(pr)) {
    return enablePullRequestAutoMerge(input, pr);
  }
  if (pr.mergeable_state !== "clean") return notCleanReason(pr);
  return mergeCleanPullRequest(input, pr);
}

export function queuePullRequestForMerge(
  input: MergeInput
): Promise<AutoMergeOutcome> {
  return withAgentMergePolicy(input, "queue", (requireImmediateMerge) =>
    queuePullRequestForMergeUnchecked({ ...input, requireImmediateMerge })
  );
}

export function mergePullRequestIfSafe(
  input: MergeInput
): Promise<AutoMergeOutcome> {
  return withAgentMergePolicy(input, "merge", (requireImmediateMerge) =>
    mergePullRequestIfSafeUnchecked({ ...input, requireImmediateMerge })
  );
}
