import { githubHeaders } from "@/lib/github-merge";

/**
 * Who may be merged without a human reviewer.
 *
 * Merge consent comes from the conversation, so the structural bound on a
 * prompt-injected merge is the pull request itself: the agent merges PRs the
 * user authored or a Mogplex run opened for them (authored by the Mogplex
 * GitHub App, which outsiders cannot impersonate). Anyone else's PR merges
 * only where the repository requires a human review, through classic branch
 * protection or a ruleset, so GitHub keeps a person in the loop; otherwise
 * the user merges it on GitHub.
 */
export type PullRequestOwnership = {
  authorLogin: string | null;
  authorIsBot: boolean;
  /**
   * GitHub's review decision. Null when classic branch protection requires no
   * review; rulesets never populate it, so those are read separately.
   */
  reviewDecision: string | null;
  baseRefName: string | null;
  url: string | null;
};

export type MergeAuthorBasis =
  | "user_author"
  | "mogplex_author"
  | "human_review";

type OwnershipGraphqlPayload = {
  data?: {
    repository?: {
      pullRequest?: {
        url?: string | null;
        reviewDecision?: string | null;
        baseRefName?: string | null;
        author?: { __typename?: string; login?: string | null } | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

const OWNERSHIP_QUERY = `query PullRequestOwnership($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      url
      reviewDecision
      baseRefName
      author { __typename login }
    }
  }
}`;

export async function loadPullRequestOwnership(input: {
  githubToken: string;
  owner: string;
  repo: string;
  number: number;
  fetchImpl?: typeof fetch;
}): Promise<PullRequestOwnership> {
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(input.githubToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: OWNERSHIP_QUERY,
      variables: { owner: input.owner, repo: input.repo, number: input.number },
    }),
  });
  const payload = (await res
    .json()
    .catch(() => null)) as OwnershipGraphqlPayload | null;
  return toOwnership(res, payload);
}

type OwnershipPullRequest = NonNullable<
  NonNullable<
    NonNullable<OwnershipGraphqlPayload["data"]>["repository"]
  >["pullRequest"]
>;

function toOwnership(
  res: Response,
  payload: OwnershipGraphqlPayload | null
): PullRequestOwnership {
  const pullRequest = payload?.data?.repository?.pullRequest;
  if (!res.ok || !pullRequest) {
    const detail = payload?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new Error(`Could not load the pull request author (${detail})`);
  }
  return readOwnership(pullRequest);
}

function readOwnership(
  pullRequest: OwnershipPullRequest
): PullRequestOwnership {
  const author = pullRequest.author ?? {};
  return {
    authorLogin: author.login ?? null,
    authorIsBot: author.__typename === "Bot",
    reviewDecision: pullRequest.reviewDecision ?? null,
    baseRefName: pullRequest.baseRefName ?? null,
    url: pullRequest.url ?? null,
  };
}

/** The Mogplex GitHub App's login, as GitHub reports a bot author. */
export function mogplexAppLogin() {
  const appName = process.env.GITHUB_APP_NAME?.trim();
  return appName ? botLogin(appName) : null;
}

function sameLogin(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a) && a?.toLowerCase() === b?.toLowerCase();
}

function botLogin(login: string) {
  const lower = login.toLowerCase();
  return lower.endsWith("[bot]") ? lower.slice(0, -"[bot]".length) : lower;
}

type RulesetRule = {
  type?: string;
  parameters?: { required_approving_review_count?: number };
};

/**
 * Whether an active ruleset on the branch requires an approving review.
 * Readable with read access; an unreadable answer counts as "not confirmed".
 */
export async function rulesetRequiresReview(input: {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  fetchImpl?: typeof fetch;
}) {
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/rules/branches/${encodeURIComponent(input.branch)}`,
    { headers: githubHeaders(input.githubToken) }
  );
  if (!res.ok) return false;
  const rules = (await res.json().catch(() => [])) as RulesetRule[];
  return (
    Array.isArray(rules) &&
    rules.some(
      (rule) =>
        rule.type === "pull_request" &&
        (rule.parameters?.required_approving_review_count ?? 0) > 0
    )
  );
}

type MergeAuthorLoaders = {
  userGithubLogin: () => Promise<string | null>;
  /** Only asked when classic protection reports no review requirement. */
  rulesetRequiresReview: (branch: string) => Promise<boolean>;
};

async function requiresHumanReview(
  ownership: PullRequestOwnership,
  loaders: MergeAuthorLoaders
) {
  if (ownership.reviewDecision) return true;
  if (!ownership.baseRefName) return false;
  return loaders.rulesetRequiresReview(ownership.baseRefName);
}

/**
 * Why this PR may be merged, or null when the user must merge it on GitHub.
 * The user's login and the rulesets are loaded only when needed.
 */
export async function mergeAuthorBasis(
  ownership: PullRequestOwnership,
  loaders: MergeAuthorLoaders
): Promise<MergeAuthorBasis | null> {
  const { authorLogin } = ownership;
  if (ownership.authorIsBot && authorLogin) {
    if (botLogin(authorLogin) === mogplexAppLogin()) return "mogplex_author";
  } else if (sameLogin(authorLogin, await loaders.userGithubLogin())) {
    return "user_author";
  }
  return (await requiresHumanReview(ownership, loaders))
    ? "human_review"
    : null;
}
