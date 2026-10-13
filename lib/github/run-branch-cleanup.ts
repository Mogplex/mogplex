/**
 * Every sandbox run pushes its working branch to origin at boot, before the
 * agent has done anything. A run that ends without commits or a pull request
 * would leave that empty branch on the user's repository forever, so the run's
 * terminal path removes it here.
 *
 * Only branch names Mogplex generates for a single run qualify. API-triggered
 * automation branches (`mogplex/automation-*`) are excluded: their caller reads
 * the run's output from that branch.
 */

const GITHUB_API_ORIGIN = "https://api.github.com";
const RUN_BRANCH_PATTERN = /^mogplex\/(?:external\/|task-|agent-)[\w./-]+$/;

export type RunBranchCleanupOutcome =
  /** The branch was empty and had no pull request, so it was deleted. */
  | "deleted"
  /** The branch holds commits or has a pull request; it stays. */
  | "kept"
  /** The branch no longer exists on GitHub. */
  | "absent"
  /** Not a per-run Mogplex branch, or GitHub could not confirm it was empty. */
  | "skipped";

/** True for a branch name Mogplex generates for one run. */
export function isDisposableRunBranch(branch: string, baseBranch: string) {
  return branch !== baseBranch && RUN_BRANCH_PATTERN.test(branch);
}

function encodeRef(ref: string) {
  return ref.split("/").map(encodeURIComponent).join("/");
}

/**
 * Delete `branch` only when it is a per-run Mogplex branch, has no commits
 * beyond `baseBranch`, and has never had a pull request. Any doubt keeps the
 * branch. Never throws.
 */
export async function deleteEmptyRunBranch(input: {
  owner: string;
  repo: string;
  baseBranch: string;
  branch: string;
  githubToken: string;
  fetchImpl?: typeof fetch;
}): Promise<RunBranchCleanupOutcome> {
  if (!isDisposableRunBranch(input.branch, input.baseBranch)) return "skipped";
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${input.githubToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mogplex-agent",
  };
  const repoPath = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;

  try {
    const compare = await fetchImpl(
      `${GITHUB_API_ORIGIN}${repoPath}/compare/${encodeRef(input.baseBranch)}...${encodeRef(input.branch)}?per_page=1`,
      { headers }
    );
    if (compare.status === 404) return "absent";
    if (!compare.ok) return "skipped";
    const { ahead_by: aheadBy } = (await compare.json()) as {
      ahead_by?: number;
    };
    if (aheadBy !== 0) return aheadBy === undefined ? "skipped" : "kept";

    const pulls = new URL(`${GITHUB_API_ORIGIN}${repoPath}/pulls`);
    pulls.searchParams.set("state", "all");
    pulls.searchParams.set("head", `${input.owner}:${input.branch}`);
    pulls.searchParams.set("per_page", "1");
    const pullsResponse = await fetchImpl(pulls, { headers });
    if (!pullsResponse.ok) return "skipped";
    const existing = (await pullsResponse.json()) as unknown;
    if (!Array.isArray(existing)) return "skipped";
    if (existing.length > 0) return "kept";

    const deleted = await fetchImpl(
      `${GITHUB_API_ORIGIN}${repoPath}/git/refs/heads/${encodeRef(input.branch)}`,
      { method: "DELETE", headers }
    );
    if (deleted.status === 204) return "deleted";
    return deleted.status === 404 || deleted.status === 422
      ? "absent"
      : "skipped";
  } catch (error) {
    console.warn("[run-branch-cleanup] cleanup failed", {
      repo: `${input.owner}/${input.repo}`,
      branch: input.branch,
      error: error instanceof Error ? error.message : "unknown",
    });
    return "skipped";
  }
}
