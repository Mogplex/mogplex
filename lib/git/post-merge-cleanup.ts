export type PostMergeCleanupArgs = {
  branch: string | null;
  dryRun: boolean;
  remotes: boolean;
};

export type PostMergeCleanupPullRequest = {
  url: string;
  state: string;
  mergedAt: string | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string | null;
};

export type PostMergeCleanupLocalBranch = {
  name: string;
  headOid: string;
  pullRequest: PostMergeCleanupPullRequest | null;
};

export type PostMergeCleanupPrunableBranch = {
  name: string;
  pullRequestUrl: string;
  deleteBranchForce: boolean;
};

export type PostMergeCleanupPlan = {
  currentBranch: string;
  defaultBranch: string;
  targetBranch: string;
  pullRequestUrl: string | null;
  shouldCheckoutDefaultBranch: boolean;
  shouldPullDefaultBranch: boolean;
  shouldDeleteBranch: boolean;
  deleteBranchForce: boolean;
  branchesToPrune: PostMergeCleanupPrunableBranch[];
};

type BuildPostMergeCleanupPlanInput = {
  currentBranch: string;
  defaultBranch: string;
  targetBranch: string;
  localHeadOid: string;
  workingTreeDirty: boolean;
  pullRequest: PostMergeCleanupPullRequest | null;
  localBranches?: PostMergeCleanupLocalBranch[];
};

export function parsePostMergeCleanupArgs(
  argv: string[]
): PostMergeCleanupArgs {
  let branch: string | null = null;
  let dryRun = false;
  let remotes = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--remotes") {
      remotes = true;
      continue;
    }

    if (arg === "--branch") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Expected a branch name after --branch.");
      }
      branch = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { branch, dryRun, remotes };
}

export type PostMergeCleanupRemoteBranch = {
  name: string;
  headOid: string;
  isAncestorOfDefault: boolean;
  pullRequest: PostMergeCleanupPullRequest | null;
};

export type PostMergeCleanupRemoteAudit = {
  landed: { name: string; reason: string }[];
  orphaned: {
    name: string;
    pullRequestUrl: string;
    headOid: string;
    mergedHeadOid: string;
  }[];
  unresolved: { name: string; reason: string }[];
};

/**
 * Classify remote branches so a human can decide what is safe to prune.
 *
 * The dangerous case this exists to catch: a PR merges, then more commits get
 * pushed to the same branch. GitHub will not re-merge them (the PR is closed),
 * so the branch looks stale while actually holding the only copy of that work.
 * Those land in `orphaned` and must never be deleted without review.
 */
export function auditRemoteBranches(input: {
  defaultBranch: string;
  remoteBranches: PostMergeCleanupRemoteBranch[];
}): PostMergeCleanupRemoteAudit {
  const audit: PostMergeCleanupRemoteAudit = {
    landed: [],
    orphaned: [],
    unresolved: [],
  };

  for (const branch of input.remoteBranches) {
    if (branch.name === input.defaultBranch) {
      continue;
    }

    // Ancestry is authoritative: if the tip is already reachable from the
    // default branch, every commit on it is landed regardless of PR metadata.
    if (branch.isAncestorOfDefault) {
      audit.landed.push({
        name: branch.name,
        reason: `already contained in ${input.defaultBranch}`,
      });
      continue;
    }

    const pullRequest = branch.pullRequest;

    if (
      pullRequest?.state !== "MERGED" ||
      !pullRequest.mergedAt ||
      pullRequest.baseRefName !== input.defaultBranch ||
      !pullRequest.headRefOid
    ) {
      audit.unresolved.push({
        name: branch.name,
        reason: pullRequest
          ? `PR ${pullRequest.url} is ${pullRequest.state.toLowerCase()}, not merged into ${input.defaultBranch}`
          : "no pull request found",
      });
      continue;
    }

    if (pullRequest.headRefOid !== branch.headOid) {
      audit.orphaned.push({
        name: branch.name,
        pullRequestUrl: pullRequest.url,
        headOid: branch.headOid,
        mergedHeadOid: pullRequest.headRefOid,
      });
      continue;
    }

    audit.landed.push({
      name: branch.name,
      reason: `tip matches merged PR head (${pullRequest.url})`,
    });
  }

  return audit;
}

export function formatRemoteBranchAudit(
  audit: PostMergeCleanupRemoteAudit,
  defaultBranch: string
): string[] {
  const orElseNone = (entries: string[]) =>
    entries.length > 0 ? entries : ["  (none)"];

  return [
    `Remote branch audit (against ${defaultBranch}):`,
    "",
    `Safe to delete — fully landed (${audit.landed.length}):`,
    ...orElseNone(audit.landed.map((b) => `  ${b.name} — ${b.reason}`)),
    "",
    `DO NOT DELETE — commits pushed after the PR merged (${audit.orphaned.length}):`,
    ...orElseNone(
      audit.orphaned.flatMap((b) => [
        `  ${b.name}`,
        `    tip ${b.headOid.slice(0, 8)} != merged head ${b.mergedHeadOid.slice(0, 8)} (${b.pullRequestUrl})`,
        `    inspect with: git log --oneline ${b.mergedHeadOid.slice(0, 8)}..origin/${b.name}`,
      ])
    ),
    "",
    `Needs a human — unresolved (${audit.unresolved.length}):`,
    ...orElseNone(audit.unresolved.map((b) => `  ${b.name} — ${b.reason}`)),
  ];
}

function buildPrunableMergedBranches(
  input: Pick<
    BuildPostMergeCleanupPlanInput,
    "currentBranch" | "defaultBranch" | "targetBranch" | "localBranches"
  >
) {
  const protectedBranchNames = new Set([
    input.currentBranch,
    input.defaultBranch,
    input.targetBranch,
  ]);

  return (input.localBranches ?? [])
    .flatMap((branch): PostMergeCleanupPrunableBranch[] => {
      if (protectedBranchNames.has(branch.name)) {
        return [];
      }

      if (
        branch.pullRequest?.state !== "MERGED" ||
        !branch.pullRequest?.mergedAt ||
        branch.pullRequest.baseRefName !== input.defaultBranch ||
        !branch.pullRequest.headRefOid ||
        branch.pullRequest.headRefOid !== branch.headOid
      ) {
        return [];
      }

      return [
        {
          name: branch.name,
          pullRequestUrl: branch.pullRequest.url,
          deleteBranchForce: true,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildPostMergeCleanupPlan(
  input: BuildPostMergeCleanupPlanInput
): PostMergeCleanupPlan {
  const branchesToPrune = buildPrunableMergedBranches(input);

  if (input.workingTreeDirty) {
    throw new Error(
      "Post-merge cleanup requires a clean working tree before switching branches."
    );
  }

  if (input.targetBranch === input.defaultBranch) {
    return {
      currentBranch: input.currentBranch,
      defaultBranch: input.defaultBranch,
      targetBranch: input.targetBranch,
      pullRequestUrl: null,
      shouldCheckoutDefaultBranch: input.currentBranch !== input.defaultBranch,
      shouldPullDefaultBranch: true,
      shouldDeleteBranch: false,
      deleteBranchForce: false,
      branchesToPrune,
    };
  }

  if (!input.pullRequest) {
    throw new Error(
      `No pull request was found for local branch ${input.targetBranch}.`
    );
  }

  if (input.pullRequest.state !== "MERGED" || !input.pullRequest.mergedAt) {
    throw new Error(`Pull request ${input.pullRequest.url} is not merged yet.`);
  }

  if (input.pullRequest.baseRefName !== input.defaultBranch) {
    throw new Error(
      `Pull request ${input.pullRequest.url} merged into ${input.pullRequest.baseRefName}, expected ${input.defaultBranch}.`
    );
  }

  if (!input.pullRequest.headRefOid) {
    throw new Error(
      `Pull request ${input.pullRequest.url} is missing its head commit SHA.`
    );
  }

  if (input.localHeadOid !== input.pullRequest.headRefOid) {
    throw new Error(
      `Local branch ${input.targetBranch} no longer matches merged PR head ${input.pullRequest.headRefOid}. Refusing to delete potentially unpublished work.`
    );
  }

  return {
    currentBranch: input.currentBranch,
    defaultBranch: input.defaultBranch,
    targetBranch: input.targetBranch,
    pullRequestUrl: input.pullRequest.url,
    shouldCheckoutDefaultBranch: input.currentBranch !== input.defaultBranch,
    shouldPullDefaultBranch: true,
    shouldDeleteBranch: true,
    deleteBranchForce: true,
    branchesToPrune,
  };
}

export function formatPostMergeCleanupPlan(
  plan: PostMergeCleanupPlan
): string[] {
  return [
    `Target branch: ${plan.targetBranch}`,
    `Default branch: ${plan.defaultBranch}`,
    ...(plan.pullRequestUrl
      ? [`Verified merged PR: ${plan.pullRequestUrl}`]
      : []),
    plan.shouldCheckoutDefaultBranch
      ? `Will switch from ${plan.currentBranch} to ${plan.defaultBranch}`
      : `Already on ${plan.defaultBranch}`,
    `Will fast-forward ${plan.defaultBranch} from origin`,
    plan.shouldDeleteBranch
      ? `Will delete local branch ${plan.targetBranch} with git branch -${plan.deleteBranchForce ? "D" : "d"}`
      : "No local branch deletion is needed",
    ...(plan.branchesToPrune.length > 0
      ? plan.branchesToPrune.map(
          (branch) =>
            `Will also prune merged local branch ${branch.name} from ${branch.pullRequestUrl}`
        )
      : ["No additional merged local branches qualified for pruning"]),
  ];
}
