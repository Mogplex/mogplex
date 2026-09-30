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
  parameters?: {
    required_approving_review_count?: number;
    require_code_owner_review?: boolean;
    require_last_push_approval?: boolean;
    required_reviewers?: Array<{ minimum_approvals?: number }>;
  };
};

const RULES_PER_PAGE = 100;
/** Bounds the read against a misbehaving API, not a product limit. */
const MAX_RULE_PAGES = 10;

/** A pull request rule that makes a person approve before merging. */
function requiresApproval(rule: RulesetRule) {
  if (rule.type !== "pull_request") return false;
  const parameters = rule.parameters ?? {};
  return (
    (parameters.required_approving_review_count ?? 0) > 0 ||
    parameters.require_code_owner_review === true ||
    parameters.require_last_push_approval === true ||
    (parameters.required_reviewers ?? []).some(
      (reviewer) => (reviewer.minimum_approvals ?? 0) > 0
    )
  );
}

type RulesInput = {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  fetchImpl?: typeof fetch;
};

/** Logged so a transient read failure is told apart from no requirement. */
function unreadableRules(input: RulesInput, reason: string) {
  console.warn("[github-merge] branch rules unreadable", {
    repo: `${input.owner}/${input.repo}`,
    branch: input.branch,
    reason,
  });
  return null;
}

/** One page of the branch's active rules, or null when it can't be read. */
async function loadRulePage(input: RulesInput, page: number) {
  const doFetch = input.fetchImpl ?? fetch;
  const path = [input.owner, input.repo, "rules", "branches", input.branch]
    .map(encodeURIComponent)
    .join("/");
  const url = `https://api.github.com/repos/${path}?per_page=${RULES_PER_PAGE}&page=${page}`;
  try {
    const res = await doFetch(url, {
      headers: githubHeaders(input.githubToken),
    });
    if (!res.ok) return unreadableRules(input, `HTTP ${res.status}`);
    const rules: unknown = await res.json();
    return Array.isArray(rules)
      ? (rules as RulesetRule[])
      : unreadableRules(input, "unexpected response body");
  } catch (error) {
    return unreadableRules(
      input,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Whether an active ruleset on the branch requires a person's approval:
 * an approval count, code-owner review, named reviewers, or approval of the
 * most recent push. GitHub returns
 * only enforced rules here, readable with read access; an unreadable answer
 * counts as "not confirmed". Ruleset bypass actors are invisible to readers,
 * so a bypass granted to the app is outside this check, as it is for classic
 * branch protection.
 */
export async function rulesetRequiresReview(input: RulesInput) {
  for (let page = 1; page <= MAX_RULE_PAGES; page += 1) {
    const rules = await loadRulePage(input, page);
    if (!rules) return false;
    if (rules.some(requiresApproval)) return true;
    if (rules.length < RULES_PER_PAGE) return false;
  }
  unreadableRules(input, `more than ${MAX_RULE_PAGES} pages of rules`);
  return false;
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
