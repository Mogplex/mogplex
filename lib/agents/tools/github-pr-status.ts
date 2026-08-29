import { z } from "zod";
import { defineTool } from "./shared";
import {
  findInstallationToken,
  normalizeLogin,
  normalizeRepoName,
} from "./github-shared";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const MAX_REVIEW_BODY_CHARS = 1_000;

type GithubPullRequestStatusOptions = { userId?: string | null };

const githubPullRequestStatusParams = z
  .object({
    owner: z
      .string()
      .describe("GitHub organization or user login, e.g. 'acme'."),
    repo: z
      .string()
      .describe("Repository name under the owner, e.g. 'widgets'."),
    number: z.number().int().positive().describe("Pull request number."),
  })
  .strict();

type GithubCheckNode = {
  __typename?: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  detailsUrl?: string | null;
  context?: string;
  state?: string;
  targetUrl?: string | null;
};

type GithubReview = {
  author?: { login?: string } | null;
  state?: string;
  body?: string | null;
  submittedAt?: string | null;
  url?: string | null;
};

type GithubReviewComment = {
  author?: { login?: string } | null;
  body?: string | null;
  createdAt?: string | null;
  url?: string | null;
};

type GithubReviewThread = {
  isResolved?: boolean;
  comments?: { nodes?: Array<GithubReviewComment | null> };
};

type GithubPullRequestStatusBody = {
  data?: {
    repository?: {
      pullRequest?: {
        number?: number;
        title?: string;
        url?: string;
        state?: string;
        isDraft?: boolean;
        headRefOid?: string;
        mergeable?: string;
        reviewDecision?: string | null;
        statusCheckRollup?: {
          state?: string;
          contexts?: {
            totalCount?: number;
            nodes?: Array<GithubCheckNode | null>;
          };
        } | null;
        reviews?: {
          totalCount?: number;
          nodes?: Array<GithubReview | null>;
        };
        reviewThreads?: {
          totalCount?: number;
          nodes?: Array<GithubReviewThread | null>;
        };
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
  message?: string;
};

type GithubPullRequestStatus = NonNullable<
  NonNullable<
    NonNullable<GithubPullRequestStatusBody["data"]>["repository"]
  >["pullRequest"]
>;

type GithubPullRequestTarget = { owner: string; repo: string };

const GITHUB_PULL_REQUEST_STATUS_QUERY = `
query MogplexPullRequestStatus($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number title url state isDraft headRefOid mergeable reviewDecision
      statusCheckRollup {
        state
        contexts(first: 100) {
          totalCount
          nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl }
            ... on StatusContext { context state targetUrl }
          }
        }
      }
      reviews(last: 50) {
        totalCount
        nodes { author { login } state body submittedAt url }
      }
      reviewThreads(first: 50) {
        totalCount
        nodes {
          isResolved
          comments(last: 5) {
            nodes { author { login } body createdAt url }
          }
        }
      }
    }
  }
}`.trim();

function normalizeTarget(input: { owner: string; repo: string }) {
  const owner = normalizeLogin(input.owner, "owner");
  if ("error" in owner) return owner;
  const repo = normalizeRepoName(input.repo);
  if ("error" in repo) return repo;
  if (!owner.value || !repo.value) {
    return { error: "owner and repo are required." };
  }
  return { owner: owner.value, repo: repo.value };
}

function lower(value: string | null | undefined) {
  return value?.toLowerCase() ?? null;
}

function truncateBody(value: string | null | undefined) {
  return value?.slice(0, MAX_REVIEW_BODY_CHARS) ?? "";
}

function normalizeChecks(nodes: Array<GithubCheckNode | null> = []) {
  return nodes.flatMap((node) => {
    if (!node) return [];
    if (node.__typename === "CheckRun") {
      return [
        {
          name: node.name ?? "unnamed check",
          status: lower(node.status),
          conclusion: lower(node.conclusion),
          url: node.detailsUrl ?? null,
        },
      ];
    }
    if (node.__typename === "StatusContext") {
      return [
        {
          name: node.context ?? "unnamed status",
          status: lower(node.state),
          conclusion: lower(node.state),
          url: node.targetUrl ?? null,
        },
      ];
    }
    return [];
  });
}

function normalizeReviews(nodes: Array<GithubReview | null> = []) {
  return nodes.flatMap((review) =>
    review
      ? [
          {
            author: review.author?.login ?? null,
            state: lower(review.state),
            body: truncateBody(review.body),
            submittedAt: review.submittedAt ?? null,
            url: review.url ?? null,
          },
        ]
      : []
  );
}

function normalizeUnresolvedThreads(
  nodes: Array<GithubReviewThread | null> = []
) {
  return (nodes ?? []).flatMap((thread) => {
    if (!thread || thread.isResolved === true) return [];
    const comments = (thread.comments?.nodes ?? []).flatMap((comment) =>
      comment
        ? [
            {
              author: comment.author?.login ?? null,
              body: truncateBody(comment.body),
              createdAt: comment.createdAt ?? null,
              url: comment.url ?? null,
            },
          ]
        : []
    );
    return [{ comments }];
  });
}

function graphqlError(body: GithubPullRequestStatusBody, status: number) {
  return (
    body.errors?.find((error) => error.message?.trim())?.message ??
    body.message ??
    `GitHub could not load pull request status (${status}).`
  );
}

function valueOrNull<T>(value: T | null | undefined): T | null {
  return value == null ? null : value;
}

function valueOr<T>(value: T | null | undefined, fallback: T): T {
  return value == null ? fallback : value;
}

function isConnectionIncomplete(
  totalCount: number | null | undefined,
  loadedCount: number
) {
  return valueOr(totalCount, loadedCount) > loadedCount;
}

async function resolveStatusToken(input: {
  userId?: string | null;
  target: GithubPullRequestTarget;
}) {
  if (!input.userId) {
    return {
      error:
        "GitHub pull request status is unavailable because the current user is not authenticated.",
    };
  }
  try {
    const githubToken = await findInstallationToken({
      userId: input.userId,
      owner: input.target.owner,
    });
    return githubToken
      ? { githubToken }
      : {
          error: `GitHub pull request status is unavailable for ${input.target.owner}/${input.target.repo}. Connect that repository, then retry.`,
        };
  } catch {
    return {
      error:
        "GitHub pull request status is temporarily unavailable. Check the repository connection, then retry.",
    };
  }
}

function presentPullRequestChecks(pullRequest: GithubPullRequestStatus) {
  const checks = normalizeChecks(
    pullRequest.statusCheckRollup?.contexts?.nodes
  );
  return {
    checkRollupState: lower(pullRequest.statusCheckRollup?.state),
    checks,
    checksIncomplete: isConnectionIncomplete(
      pullRequest.statusCheckRollup?.contexts?.totalCount,
      checks.length
    ),
  };
}

function presentPullRequestReviews(pullRequest: GithubPullRequestStatus) {
  const formalReviews = normalizeReviews(pullRequest.reviews?.nodes);
  const unresolvedReviewThreads = normalizeUnresolvedThreads(
    pullRequest.reviewThreads?.nodes
  );
  const loadedReviewThreadCount = valueOr(
    pullRequest.reviewThreads?.nodes?.length,
    0
  );
  const totalReviewThreadCount = valueOr(
    pullRequest.reviewThreads?.totalCount,
    loadedReviewThreadCount
  );
  return {
    formalReviews,
    formalReviewsIncomplete: isConnectionIncomplete(
      pullRequest.reviews?.totalCount,
      formalReviews.length
    ),
    unresolvedReviewThreadCount: unresolvedReviewThreads.length,
    unresolvedReviewThreads,
    reviewThreadsIncomplete: isConnectionIncomplete(
      totalReviewThreadCount,
      loadedReviewThreadCount
    ),
  };
}

function presentPullRequestStatus(input: {
  target: GithubPullRequestTarget;
  requestedNumber: number;
  pullRequest: GithubPullRequestStatus;
}) {
  const { pullRequest } = input;
  return {
    ok: true,
    repo: `${input.target.owner}/${input.target.repo}`,
    pullRequestNumber: valueOr(pullRequest.number, input.requestedNumber),
    title: valueOrNull(pullRequest.title),
    url: pullRequest.url,
    state: lower(pullRequest.state),
    draft: pullRequest.isDraft === true,
    headSha: pullRequest.headRefOid,
    mergeable: lower(pullRequest.mergeable),
    reviewDecision: lower(pullRequest.reviewDecision),
    ...presentPullRequestChecks(pullRequest),
    ...presentPullRequestReviews(pullRequest),
  };
}

async function loadPullRequestStatus(input: {
  target: GithubPullRequestTarget;
  number: number;
  githubToken: string;
}) {
  try {
    const response = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.githubToken}`,
        "Content-Type": "application/json",
        "User-Agent": "mogplex-agent",
      },
      body: JSON.stringify({
        query: GITHUB_PULL_REQUEST_STATUS_QUERY,
        variables: { ...input.target, number: input.number },
      }),
    });
    const body = (await response
      .json()
      .catch(() => ({}))) as GithubPullRequestStatusBody;
    if (!response.ok || body.errors?.length) {
      return { error: graphqlError(body, response.status) };
    }
    const pullRequest = body.data?.repository?.pullRequest;
    if (!pullRequest?.url || !pullRequest.headRefOid) {
      return {
        error: `GitHub pull request #${input.number} was not found in ${input.target.owner}/${input.target.repo}.`,
      };
    }
    return presentPullRequestStatus({
      target: input.target,
      requestedNumber: input.number,
      pullRequest,
    });
  } catch {
    return {
      error:
        "GitHub pull request status is temporarily unavailable. Retry the request.",
    };
  }
}

export function createGithubPullRequestStatusTool(
  options: GithubPullRequestStatusOptions = {}
) {
  return defineTool({
    description:
      "Load a pull request's exact head commit, draft and merge state, CI status, formal reviews, and unresolved review threads from a repository covered by the current user's GitHub connection. Read this before reporting PR readiness or requesting a protected merge.",
    inputSchema: githubPullRequestStatusParams,
    execute: async ({
      owner,
      repo,
      number,
    }: z.infer<typeof githubPullRequestStatusParams>) => {
      const target = normalizeTarget({ owner, repo });
      if ("error" in target) return { error: target.error };
      const auth = await resolveStatusToken({
        userId: options.userId,
        target,
      });
      if ("error" in auth) return auth;
      return loadPullRequestStatus({ target, number, ...auth });
    },
  });
}
