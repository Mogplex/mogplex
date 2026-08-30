import { findBillingAccountForScope } from "@/lib/billing/accounts";
import { getBillingBalance } from "@/lib/billing/ledger";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { createGithubIssue } from "@/lib/github-issues";
import { mergePullRequestIfSafe } from "@/lib/github-merge";
import type { MogplexApiRepo } from "@/lib/mogplex-api/repos";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type SlackUsageSummary = {
  plan: string;
  status: string;
  includedCents: number;
  purchasedCents: number;
  totalCents: number;
};

export type SlackPullRequestSummary = {
  number: number;
  title: string;
  url: string;
  author: string | null;
  isDraft: boolean;
  mergeable: string | null;
  reviewDecision: string | null;
  checkState: string | null;
  unresolvedReviewThreads: number;
  headSha: string;
};

export type SlackPullRequestList = {
  totalCount: number;
  pullRequests: SlackPullRequestSummary[];
};

export type SlackIssueSummary = {
  number: number;
  title: string;
  url: string;
  author: string | null;
  updatedAt: string | null;
};

export type SlackIssueList = {
  totalCount: number;
  issues: SlackIssueSummary[];
};

type GithubRepoInput = Pick<MogplexApiRepo, "full_name" | "installation_id"> & {
  id: string;
};

type GithubGraphqlResponse<T> = {
  data?: { repository?: T | null };
  errors?: Array<{ message?: string }>;
};

type SlackCommandDataDeps = {
  findBillingAccount: typeof findBillingAccountForScope;
  getBalance: typeof getBillingBalance;
  getGithubToken: typeof getGithubAccessTokenForRepo;
  graphql: typeof githubGraphql;
  createIssue: typeof createGithubIssue;
  mergePullRequest: typeof mergePullRequestIfSafe;
};

const defaultDataDeps: SlackCommandDataDeps = {
  findBillingAccount: findBillingAccountForScope,
  getBalance: getBillingBalance,
  getGithubToken: getGithubAccessTokenForRepo,
  graphql: githubGraphql,
  createIssue: createGithubIssue,
  mergePullRequest: mergePullRequestIfSafe,
};

function splitRepoFullName(fullName: string) {
  const [owner, repo, ...rest] = fullName.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error("Invalid linked repository name");
  }
  return { owner, repo };
}

async function githubTokenForRepo(
  userId: string,
  repo: GithubRepoInput,
  getToken: typeof getGithubAccessTokenForRepo
) {
  const token = await getToken(
    {
      user_id: userId,
      github_installation_id: repo.installation_id,
    },
    userId
  );
  if (!token)
    throw new Error("GitHub access is unavailable for this repository");
  return token;
}

async function githubGraphql<T>(input: {
  token: string;
  query: string;
  variables: Record<string, unknown>;
}) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      "User-Agent": "mogplex-slack",
    },
    body: JSON.stringify({ query: input.query, variables: input.variables }),
    cache: "no-store",
  });
  const body = (await response
    .json()
    .catch(() => ({}))) as GithubGraphqlResponse<T>;
  if (!response.ok || body.errors?.length || !body.data?.repository) {
    throw new Error("GitHub could not load the linked repository");
  }
  return body.data.repository;
}

export async function loadLatestSlackRun(input: {
  userId: string;
  teamId: string;
  slackUserId: string;
  client?: Pick<typeof supabaseAdmin, "from">;
}): Promise<ExternalAgentRunRow | null> {
  const { client = supabaseAdmin } = input;
  const { data, error } = await client
    .from("external_agent_runs")
    .select("*")
    .eq("user_id", input.userId)
    .contains("metadata", {
      slack_team_id: input.teamId,
      slack_user_id: input.slackUserId,
    })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load Slack run: ${error.message}`);
  return (data as ExternalAgentRunRow | null) ?? null;
}

export async function loadSlackUsageSummary(
  userId: string,
  overrides: Partial<SlackCommandDataDeps> = {}
): Promise<SlackUsageSummary> {
  const deps = { ...defaultDataDeps, ...overrides };
  const account = await deps.findBillingAccount({
    kind: "personal",
    userId,
    productTeamId: null,
  });
  const balance = account
    ? await deps.getBalance(account.id)
    : { includedCents: 0, purchasedCents: 0, totalCents: 0 };
  return {
    plan: account?.plan_code ?? account?.tier ?? "free",
    status: account?.status ?? "active",
    ...balance,
  };
}

const PULL_REQUESTS_QUERY = `
query MogplexSlackPullRequests($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 5, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        number title url isDraft mergeable reviewDecision headRefOid
        author { login }
        statusCheckRollup { state }
        reviewThreads(first: 50) { nodes { isResolved } }
      }
    }
  }
}`.trim();

type PullRequestRepository = {
  pullRequests?: {
    totalCount?: number;
    nodes?: Array<{
      number?: number;
      title?: string;
      url?: string;
      isDraft?: boolean;
      mergeable?: string;
      reviewDecision?: string | null;
      headRefOid?: string;
      author?: { login?: string } | null;
      statusCheckRollup?: { state?: string } | null;
      reviewThreads?: { nodes?: Array<{ isResolved?: boolean } | null> };
    } | null>;
  };
};

function presentPullRequestNode(
  node: NonNullable<
    NonNullable<PullRequestRepository["pullRequests"]>["nodes"]
  >[number]
): SlackPullRequestSummary | null {
  if (!node) return null;
  const { number, title, url, headRefOid } = node;
  if (typeof number !== "number" || !title || !url || !headRefOid) return null;
  const unresolvedReviewThreads = (node.reviewThreads?.nodes ?? []).filter(
    (thread) => thread && thread.isResolved !== true
  ).length;
  return {
    number,
    title,
    url,
    author: node.author?.login ?? null,
    isDraft: node.isDraft === true,
    mergeable: node.mergeable?.toLowerCase() ?? null,
    reviewDecision: node.reviewDecision?.toLowerCase() ?? null,
    checkState: node.statusCheckRollup?.state?.toLowerCase() ?? null,
    unresolvedReviewThreads,
    headSha: headRefOid,
  };
}

export async function listSlackRepoPullRequests(input: {
  userId: string;
  repo: GithubRepoInput;
  deps?: Partial<SlackCommandDataDeps>;
}): Promise<SlackPullRequestList> {
  const deps = { ...defaultDataDeps, ...input.deps };
  const target = splitRepoFullName(input.repo.full_name);
  const token = await githubTokenForRepo(
    input.userId,
    input.repo,
    deps.getGithubToken
  );
  const repository = await deps.graphql<PullRequestRepository>({
    token,
    query: PULL_REQUESTS_QUERY,
    variables: target,
  });
  const nodes = repository.pullRequests?.nodes ?? [];
  const pullRequests = nodes.flatMap((node) => {
    const presented = presentPullRequestNode(node);
    return presented ? [presented] : [];
  });
  return {
    totalCount: repository.pullRequests?.totalCount ?? pullRequests.length,
    pullRequests,
  };
}

const ISSUES_QUERY = `
query MogplexSlackIssues($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    issues(first: 10, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes { number title url updatedAt author { login } }
    }
  }
}`.trim();

type IssueRepository = {
  issues?: {
    totalCount?: number;
    nodes?: Array<{
      number?: number;
      title?: string;
      url?: string;
      updatedAt?: string;
      author?: { login?: string } | null;
    } | null>;
  };
};

export async function listSlackRepoIssues(input: {
  userId: string;
  repo: GithubRepoInput;
  deps?: Partial<SlackCommandDataDeps>;
}): Promise<SlackIssueList> {
  const deps = { ...defaultDataDeps, ...input.deps };
  const target = splitRepoFullName(input.repo.full_name);
  const token = await githubTokenForRepo(
    input.userId,
    input.repo,
    deps.getGithubToken
  );
  const repository = await deps.graphql<IssueRepository>({
    token,
    query: ISSUES_QUERY,
    variables: target,
  });
  const nodes = repository.issues?.nodes ?? [];
  const issues = nodes.flatMap((node) => {
    if (!node || typeof node.number !== "number" || !node.title || !node.url) {
      return [];
    }
    return [
      {
        number: node.number,
        title: node.title,
        url: node.url,
        author: node.author?.login ?? null,
        updatedAt: node.updatedAt ?? null,
      },
    ];
  });
  return {
    totalCount: repository.issues?.totalCount ?? issues.length,
    issues,
  };
}

export async function createSlackRepoIssue(input: {
  userId: string;
  repo: GithubRepoInput;
  title: string;
  body: string;
  deps?: Partial<SlackCommandDataDeps>;
}) {
  const deps = { ...defaultDataDeps, ...input.deps };
  const token = await githubTokenForRepo(
    input.userId,
    input.repo,
    deps.getGithubToken
  );
  return deps.createIssue({
    githubToken: token,
    repoFullName: input.repo.full_name,
    title: input.title,
    body: input.body,
  });
}

export async function mergeSlackRepoPullRequest(input: {
  userId: string;
  repo: GithubRepoInput;
  prNumber: number;
  expectedHeadSha: string;
  deps?: Partial<SlackCommandDataDeps>;
}) {
  const deps = { ...defaultDataDeps, ...input.deps };
  const token = await githubTokenForRepo(
    input.userId,
    input.repo,
    deps.getGithubToken
  );
  const target = splitRepoFullName(input.repo.full_name);
  return deps.mergePullRequest({
    githubToken: token,
    owner: target.owner,
    repo: target.repo,
    prNumber: input.prNumber,
    expectedHeadSha: input.expectedHeadSha,
  });
}
