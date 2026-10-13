/**
 * Branch inventory for repository housekeeping: every branch with its pull
 * requests and how far it has diverged from the default branch, classified
 * by whether deleting it would lose work.
 */

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
// Each branch costs a comparison and a pull request lookup on GitHub's side,
// so pages stay small enough to answer well inside GraphQL's time budget.
export const BRANCH_PAGE_SIZE = 50;

export type BranchStatus =
  /** The default branch itself. Never deleted. */
  | "default"
  /** Has an open pull request; deleting the branch would close it. */
  | "open_pull_request"
  /** Every commit on the branch is already on the default branch. */
  | "merged"
  /** Its pull request merged at the branch's current commit (squash or rebase). */
  | "squash_merged"
  /** Its pull request closed without merging; the commits exist nowhere else. */
  | "closed_unmerged"
  /** Holds commits that are not on the default branch and has no pull request. */
  | "unmerged";

export type BranchPullRequest = {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  headRefOid: string | null;
  url: string | null;
};

export type BranchSnapshot = {
  name: string;
  sha: string | null;
  committedAt: string | null;
  isProtected: boolean;
  /** Commits on this branch that the default branch does not have. */
  commitsNotOnDefault: number | null;
  pullRequests: BranchPullRequest[];
};

export type ClassifiedBranch = {
  name: string;
  sha: string | null;
  committedAt: string | null;
  status: BranchStatus;
  protected: boolean;
  /** True when deleting the branch cannot lose work or close a pull request. */
  safeToDelete: boolean;
  commitsNotOnDefault: number | null;
  pullRequest: { number: number; state: string; url: string | null } | null;
};

const SAFE_STATUSES: ReadonlySet<BranchStatus> = new Set([
  "merged",
  "squash_merged",
]);

function pickPullRequest(
  pulls: BranchPullRequest[],
  sha: string | null
): { status: BranchStatus; pull: BranchPullRequest } | null {
  const open = pulls.find((pull) => pull.state === "OPEN");
  if (open) return { status: "open_pull_request", pull: open };
  // A merged pull request only proves the work landed if the branch has not
  // moved since; later commits on the branch exist nowhere else.
  const mergedAtTip = pulls.find(
    (pull) => pull.state === "MERGED" && sha && pull.headRefOid === sha
  );
  if (mergedAtTip) return { status: "squash_merged", pull: mergedAtTip };
  const closedAtTip = pulls.find(
    (pull) => pull.state === "CLOSED" && sha && pull.headRefOid === sha
  );
  if (closedAtTip) return { status: "closed_unmerged", pull: closedAtTip };
  return null;
}

/** Classify one branch by whether deleting it would lose work. */
export function classifyBranch(
  branch: BranchSnapshot,
  defaultBranch: string
): ClassifiedBranch {
  const base = {
    name: branch.name,
    sha: branch.sha,
    committedAt: branch.committedAt,
    protected: branch.isProtected,
    commitsNotOnDefault: branch.commitsNotOnDefault,
  };
  const fromPull = pickPullRequest(branch.pullRequests, branch.sha);
  const status: BranchStatus =
    branch.name === defaultBranch
      ? "default"
      : fromPull?.status === "open_pull_request"
        ? "open_pull_request"
        : branch.commitsNotOnDefault === 0
          ? "merged"
          : (fromPull?.status ?? "unmerged");
  const pull = fromPull?.pull ?? branch.pullRequests[0] ?? null;
  return {
    ...base,
    status,
    safeToDelete: SAFE_STATUSES.has(status) && !branch.isProtected,
    pullRequest: pull
      ? { number: pull.number, state: pull.state, url: pull.url }
      : null,
  };
}

const BRANCH_INVENTORY_QUERY = `
query BranchInventory($owner: String!, $name: String!, $after: String, $first: Int!, $defaultRef: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    refs(refPrefix: "refs/heads/", first: $first, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        branchProtectionRule { id }
        target { oid ... on Commit { committedDate } }
        compare(headRef: $defaultRef) { behindBy }
        associatedPullRequests(first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes { number state headRefOid url }
        }
      }
    }
  }
}`;

type RefNode = {
  name?: string;
  branchProtectionRule?: { id?: string } | null;
  target?: { oid?: string; committedDate?: string } | null;
  compare?: { behindBy?: number } | null;
  associatedPullRequests?: {
    nodes?: Array<Partial<BranchPullRequest> | null> | null;
  } | null;
};

type InventoryResponse = {
  data?: {
    repository?: {
      defaultBranchRef?: { name?: string } | null;
      refs?: {
        totalCount?: number;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: Array<RefNode | null>;
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

function toSnapshot(node: RefNode): BranchSnapshot | null {
  if (!node.name) return null;
  const pulls = (node.associatedPullRequests?.nodes ?? []).flatMap((pull) =>
    pull?.number && pull.state
      ? [
          {
            number: pull.number,
            state: pull.state,
            headRefOid: pull.headRefOid ?? null,
            url: pull.url ?? null,
          },
        ]
      : []
  );
  // `compare` treats this branch as the base, so `behindBy` counts commits
  // on this branch that the default branch lacks.
  const behindBy = node.compare?.behindBy;
  return {
    name: node.name,
    sha: node.target?.oid ?? null,
    committedAt: node.target?.committedDate ?? null,
    isProtected: Boolean(node.branchProtectionRule),
    commitsNotOnDefault: typeof behindBy === "number" ? behindBy : null,
    pullRequests: pulls,
  };
}

export type BranchInventoryPage = {
  defaultBranch: string;
  totalBranches: number;
  branches: ClassifiedBranch[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
};

/** Load and classify one page of branches. */
export async function loadBranchInventoryPage(input: {
  owner: string;
  repo: string;
  defaultBranch: string;
  githubToken: string;
  cursor?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<BranchInventoryPage | { error: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "mogplex-agent",
    },
    body: JSON.stringify({
      query: BRANCH_INVENTORY_QUERY,
      variables: {
        owner: input.owner,
        name: input.repo,
        after: input.cursor ?? null,
        first: BRANCH_PAGE_SIZE,
        defaultRef: `refs/heads/${input.defaultBranch}`,
      },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as InventoryResponse;
  const refs = body.data?.repository?.refs;
  if (!response.ok || !refs) {
    const detail = body.errors?.[0]?.message;
    return {
      error: `GitHub could not list branches for ${input.owner}/${input.repo}${detail ? `: ${detail}` : ` (${response.status})`}.`,
    };
  }
  const defaultBranch =
    body.data?.repository?.defaultBranchRef?.name ?? input.defaultBranch;
  const branches: ClassifiedBranch[] = [];
  for (const node of refs.nodes ?? []) {
    const snapshot = node ? toSnapshot(node) : null;
    if (snapshot) branches.push(classifyBranch(snapshot, defaultBranch));
  }
  return {
    defaultBranch,
    totalBranches: refs.totalCount ?? branches.length,
    branches,
    nextCursor:
      refs.pageInfo?.hasNextPage && refs.pageInfo.endCursor
        ? refs.pageInfo.endCursor
        : null,
  };
}
