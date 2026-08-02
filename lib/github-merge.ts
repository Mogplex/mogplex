export type AutoMergeOutcome = {
  merged: boolean;
  queued?: boolean;
  reason: string;
  sha?: string | null;
};

type PullRequestGate = {
  state?: string;
  draft?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  node_id?: string;
  head?: { sha?: string };
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
};

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
}

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

function readGraphqlErrors(payload: AutoMergeGraphqlPayload | null) {
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

// Merge immediately only when GitHub itself reports the PR as safe: open, not
// a draft, no conflicts, and `mergeable_state === "clean"`. If required checks
// or branch protection are still pending, arm GitHub's native auto-merge so a
// later webhook-driven state transition completes the merge without polling.
// The direct merge pins the reviewed head. Native auto-merge validates that
// head when enabled. GitHub can keep it enabled after later pushes, but still
// enforces required checks and branch protection on the current head.
export async function mergePullRequestIfSafe(
  input: MergeInput
): Promise<AutoMergeOutcome> {
  const pr = await loadPullRequestGate(input);
  const blocked = pullRequestBlockReason(input, pr);
  if (blocked) return blocked;
  if (shouldEnablePullRequestAutoMerge(pr)) {
    return enablePullRequestAutoMerge(input, pr);
  }
  if (pr.mergeable_state !== "clean") {
    return {
      merged: false,
      reason: `PR is not clean to merge (state: ${pr.mergeable_state ?? "unknown"})`,
    };
  }
  return mergeCleanPullRequest(input, pr);
}
