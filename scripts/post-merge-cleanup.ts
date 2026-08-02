import { execFileSync } from "node:child_process";
import {
  auditRemoteBranches,
  buildPostMergeCleanupPlan,
  formatPostMergeCleanupPlan,
  formatRemoteBranchAudit,
  parsePostMergeCleanupArgs,
  type PostMergeCleanupRemoteBranch,
} from "../lib/git/post-merge-cleanup";

type RepoView = {
  nameWithOwner: string;
  defaultBranchRef: { name: string };
};

type PullRequestLookup = {
  number: number;
};

type PullRequestView = {
  url: string;
  state: string;
  mergedAt: string | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string | null;
};

type LocalBranch = {
  name: string;
  headOid: string;
};

function runCommand(command: string, args: string[], inherit = false) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
}

function runJson<T>(command: string, args: string[]) {
  return JSON.parse(runCommand(command, args)) as T;
}

function loadLocalBranches() {
  return runCommand("git", [
    "for-each-ref",
    "refs/heads",
    "--format=%(refname:short)%09%(objectname)",
  ])
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): LocalBranch => {
      const [name, headOid] = line.split("\t");

      return {
        name,
        headOid,
      };
    });
}

function loadPullRequest(targetBranch: string, localHeadOid: string) {
  const pullRequests = runJson<PullRequestLookup[]>("gh", [
    "pr",
    "list",
    "--head",
    targetBranch,
    "--state",
    "all",
    "--json",
    "number",
    "--limit",
    "20",
  ]);

  if (pullRequests.length === 0) {
    return null;
  }

  const details = pullRequests.map((pullRequest) =>
    runJson<PullRequestView>("gh", [
      "pr",
      "view",
      String(pullRequest.number),
      "--json",
      "url,state,mergedAt,baseRefName,headRefName,headRefOid",
    ])
  );

  return (
    details.find((pullRequest) => pullRequest.headRefOid === localHeadOid) ??
    details[0]
  );
}

function loadCandidateBranches(
  currentBranch: string,
  defaultBranch: string,
  targetBranch: string
) {
  return loadLocalBranches().map((branch) => {
    if (
      branch.name === currentBranch ||
      branch.name === defaultBranch ||
      branch.name === targetBranch
    ) {
      return {
        ...branch,
        pullRequest: null,
      };
    }

    try {
      return {
        ...branch,
        pullRequest: loadPullRequest(branch.name, branch.headOid),
      };
    } catch (error) {
      console.warn(
        `[git:cleanup] Skipping branch ${branch.name} because its pull request could not be inspected`,
        error
      );
      return {
        ...branch,
        pullRequest: null,
      };
    }
  });
}

function loadRemoteBranches(defaultBranch: string) {
  const branches = runCommand("git", [
    "for-each-ref",
    "refs/remotes/origin",
    "--format=%(refname:short)%09%(objectname)%09%(symref)",
  ])
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [refName, headOid, symref] = line.split("\t");
      return { name: refName.replace(/^origin\//, ""), headOid, symref };
    })
    // `origin/HEAD` is a symbolic ref that shortens to plain `origin`, so drop
    // any symref rather than filtering on the name.
    .filter(
      (branch) =>
        !branch.symref &&
        branch.name !== "HEAD" &&
        branch.name !== defaultBranch
    )
    .map(({ name, headOid }) => ({ name, headOid }));

  return branches.map((branch): PostMergeCleanupRemoteBranch => {
    const isAncestorOfDefault = isAncestor(
      branch.headOid,
      `origin/${defaultBranch}`
    );

    // Ancestors are already proven landed; skip the API round-trip.
    if (isAncestorOfDefault) {
      return { ...branch, isAncestorOfDefault, pullRequest: null };
    }

    try {
      return {
        ...branch,
        isAncestorOfDefault,
        pullRequest: loadPullRequest(branch.name, branch.headOid),
      };
    } catch (error) {
      console.warn(
        `[git:cleanup] Could not inspect the pull request for origin/${branch.name}`,
        error
      );
      return { ...branch, isAncestorOfDefault, pullRequest: null };
    }
  });
}

function isAncestor(maybeAncestor: string, descendant: string) {
  try {
    runCommand("git", [
      "merge-base",
      "--is-ancestor",
      maybeAncestor,
      descendant,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Report-only by design: this never deletes a remote ref. Deleting the wrong one
 * destroys the only copy of any post-merge commits, so the decision stays with a
 * human.
 */
function reportRemoteBranchAudit(defaultBranch: string) {
  const audit = auditRemoteBranches({
    defaultBranch,
    remoteBranches: loadRemoteBranches(defaultBranch),
  });

  for (const line of formatRemoteBranchAudit(audit, defaultBranch)) {
    console.log(line);
  }
}

function resolveBranchHeadOid(targetBranch: string) {
  try {
    return runCommand("git", [
      "rev-parse",
      `refs/heads/${targetBranch}`,
    ]).trim();
  } catch {
    throw new Error(`Local branch ${targetBranch} does not exist.`);
  }
}

function main() {
  const args = parsePostMergeCleanupArgs(
    process.argv.slice(2).filter((arg) => arg !== "--")
  );

  runCommand("git", ["remote", "get-url", "origin"]);
  runCommand("git", ["fetch", "origin", "--prune"], true);

  const currentBranch = runCommand("git", ["branch", "--show-current"]).trim();
  const repo = runJson<RepoView>("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner,defaultBranchRef",
  ]);
  const defaultBranch = repo.defaultBranchRef.name;

  if (args.remotes) {
    reportRemoteBranchAudit(defaultBranch);
    return;
  }

  const targetBranch = args.branch ?? currentBranch;
  const localHeadOid = resolveBranchHeadOid(targetBranch);
  const workingTreeDirty =
    runCommand("git", ["status", "--short"]).trim().length > 0;
  const pullRequest =
    targetBranch === defaultBranch
      ? null
      : loadPullRequest(targetBranch, localHeadOid);
  const localBranches = loadCandidateBranches(
    currentBranch,
    defaultBranch,
    targetBranch
  );

  const plan = buildPostMergeCleanupPlan({
    currentBranch,
    defaultBranch,
    targetBranch,
    localHeadOid,
    workingTreeDirty,
    pullRequest,
    localBranches,
  });

  for (const line of formatPostMergeCleanupPlan(plan)) {
    console.log(line);
  }

  if (args.dryRun) {
    console.log("Dry run complete.");
    return;
  }

  if (plan.shouldCheckoutDefaultBranch) {
    runCommand("git", ["checkout", plan.defaultBranch], true);
  }

  if (plan.shouldPullDefaultBranch) {
    runCommand(
      "git",
      ["pull", "--ff-only", "origin", plan.defaultBranch],
      true
    );
  }

  if (plan.shouldDeleteBranch) {
    runCommand(
      "git",
      ["branch", plan.deleteBranchForce ? "-D" : "-d", plan.targetBranch],
      true
    );
  }

  for (const branch of plan.branchesToPrune) {
    runCommand(
      "git",
      ["branch", branch.deleteBranchForce ? "-D" : "-d", branch.name],
      true
    );
  }

  console.log("Post-merge cleanup complete.");
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Post-merge cleanup failed."
  );
  process.exit(1);
}
