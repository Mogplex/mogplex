import { z } from "zod";
import { defineTool } from "./shared";
import {
  normalizeLogin,
  normalizeRepoName,
  findInstallationToken,
} from "./github-shared";

const GITHUB_API_ORIGIN = "https://api.github.com";

export type GithubPrSearchOptions = {
  oauthToken?: string | null;
  userId?: string | null;
};

type GithubPrSearchAuth = {
  token: string;
  source: "oauth" | "github_app_installation";
  coverage: "oauth" | "app";
};

type GithubPrGraphqlPullRequest = {
  __typename?: string;
  repository?: { nameWithOwner?: string };
  number?: number;
  title?: string;
  state?: string;
  url?: string;
  author?: { login?: string } | null;
  isDraft?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type GithubPrGraphqlBody = {
  data?: {
    search?: {
      issueCount?: number;
      nodes?: Array<GithubPrGraphqlPullRequest | null>;
    };
    rateLimit?: { limit?: number; remaining?: number; resetAt?: string };
  };
  errors?: Array<{ message?: string; type?: string }>;
  message?: string;
};

function isConflictingQualifier(term: string) {
  const normalized = term.startsWith("-") ? term.slice(1) : term;
  const separatorIndex = normalized.indexOf(":");
  if (separatorIndex === -1) return false;
  const qualifier = normalized.slice(0, separatorIndex).toLowerCase();
  const value = normalized.slice(separatorIndex + 1).toLowerCase();
  if (qualifier === "is")
    return ["pr", "issue", "open", "closed", "draft"].includes(value);
  if (qualifier === "type") return ["pr", "issue"].includes(value);
  return ["state", "author", "org", "user", "repo"].includes(qualifier);
}

function normalizeSearchText(value: string | undefined) {
  const trimmed = value
    ?.trim()
    .split(/\s+/)
    .filter((t) => !isConflictingQualifier(t))
    .join(" ");
  return trimmed ? trimmed.slice(0, 300) : null;
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mogplex-agent",
  };
}

const GRAPHQL_QUERY = `
query MogplexPullRequestSearch($query: String!, $first: Int!) {
  search(query: $query, type: ISSUE, first: $first) {
    issueCount
    nodes { __typename ... on PullRequest { repository { nameWithOwner } number title url author { login } state isDraft createdAt updatedAt } }
  }
  rateLimit { limit remaining resetAt }
}`.trim();

function unavailableError(warnings: string[] = []) {
  return {
    error:
      "Authenticated GitHub PR search is unavailable. Connect GitHub OAuth or install the Mogplex GitHub App for the requested owner.",
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

async function resolveAuthCandidates(input: {
  oauthToken?: string | null;
  userId?: string | null;
  owner?: string | null;
}) {
  const auths: GithubPrSearchAuth[] = [];
  const warnings: string[] = [];
  if (input.owner) {
    try {
      const tok = await findInstallationToken(input);
      if (tok)
        auths.push({
          token: tok,
          source: "github_app_installation",
          coverage: "app",
        });
    } catch (error) {
      warnings.push(
        `GitHub App installation lookup failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }
  const oauthToken = input.oauthToken?.trim();
  if (oauthToken)
    auths.push({ token: oauthToken, source: "oauth", coverage: "oauth" });
  if (auths.length === 0) return unavailableError(warnings);
  return { auths, warnings };
}

function graphqlErrorMessage(body: GithubPrGraphqlBody) {
  const err = body.errors?.find(
    (e) => typeof e.message === "string" && e.message.trim()
  );
  if (err?.message) return err.message;
  if (typeof body.message === "string" && body.message.trim())
    return body.message;
  return "GitHub PR search failed";
}

function isRateLimited(body: GithubPrGraphqlBody) {
  return body.errors?.some((e) => e.type === "RATE_LIMITED") ?? false;
}

function isAuthFailed(body: GithubPrGraphqlBody) {
  return (
    body.errors?.some((e) => {
      const type = e.type?.toUpperCase();
      const msg = e.message?.toLowerCase() ?? "";
      return (
        type === "FORBIDDEN" ||
        type === "UNAUTHORIZED" ||
        msg.includes("resource not accessible by integration") ||
        msg.includes("bad credentials") ||
        msg.includes("requires authentication")
      );
    }) ?? false
  );
}

function shouldRetryWithNextAuth(input: {
  status: number;
  authFailed?: boolean;
  rateLimited?: boolean;
}) {
  return (
    input.status === 401 ||
    input.status === 403 ||
    input.status === 429 ||
    Boolean(input.authFailed) ||
    Boolean(input.rateLimited)
  );
}

function retryWarning(input: {
  source: GithubPrSearchAuth["source"];
  status: number;
  error?: string;
}) {
  const reason =
    input.status >= 400
      ? `status ${input.status}`
      : `GitHub GraphQL error: ${input.error ?? "unknown error"}`;
  return `${input.source} GitHub PR search failed with ${reason}; retried with the next available credential.`;
}

function parseBody(raw: string): GithubPrGraphqlBody {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as GithubPrGraphqlBody;
  } catch {
    return { message: raw };
  }
}

function readRateLimit(body: GithubPrGraphqlBody) {
  const r = body.data?.rateLimit;
  return {
    limit: r?.limit ?? null,
    remaining: r?.remaining ?? null,
    reset: r?.resetAt ?? null,
  };
}

function normalizeState(state: unknown) {
  return typeof state === "string" ? state.toLowerCase() : null;
}

function describeDraft(isDraft: unknown) {
  return typeof isDraft === "boolean"
    ? { draft: isDraft }
    : {
        warnings: [
          "Draft status was not returned by GitHub for this pull request.",
        ],
      };
}

function mapNode(node: GithubPrGraphqlPullRequest) {
  return {
    repo: node.repository?.nameWithOwner ?? null,
    number: node.number ?? null,
    title: node.title ?? null,
    url: node.url ?? null,
    author: node.author?.login ?? null,
    state: normalizeState(node.state),
    ...describeDraft(node.isDraft),
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
  };
}

async function runGraphqlSearch(input: {
  auth: GithubPrSearchAuth;
  searchQuery: string;
  limit: number;
}) {
  const res = await fetch(`${GITHUB_API_ORIGIN}/graphql`, {
    method: "POST",
    headers: {
      ...githubHeaders(input.auth.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: GRAPHQL_QUERY,
      variables: { query: input.searchQuery, first: input.limit },
    }),
    cache: "no-store",
  });
  const body = parseBody(await res.text());
  const rateLimit = readRateLimit(body);
  const rateLimited = isRateLimited(body);
  const authFailed = isAuthFailed(body);
  if (!res.ok || body.errors?.length) {
    return {
      ok: false,
      status: res.status,
      query: input.searchQuery,
      auth: { source: input.auth.source, coverage: input.auth.coverage },
      error: graphqlErrorMessage(body),
      rateLimit,
      authFailed,
      rateLimited,
    };
  }
  const nodes = body.data?.search?.nodes ?? [];
  const items = nodes
    .filter(
      (n): n is GithubPrGraphqlPullRequest => n?.__typename === "PullRequest"
    )
    .map(mapNode);
  return {
    ok: true,
    status: res.status,
    query: input.searchQuery,
    auth: { source: input.auth.source, coverage: input.auth.coverage },
    totalCount:
      typeof body.data?.search?.issueCount === "number"
        ? body.data.search.issueCount
        : items.length,
    incompleteResults: false,
    items,
    rateLimit,
  };
}

function normalizeInputs(input: {
  owner?: string;
  repo?: string;
  author?: string;
}):
  | { owner: string | null; repo: string | null; author: string | null }
  | { error: string } {
  const ownerResult = normalizeLogin(input.owner, "owner");
  if ("error" in ownerResult) return { error: ownerResult.error };
  const repoResult = normalizeRepoName(input.repo);
  if ("error" in repoResult) return { error: repoResult.error };
  const authorResult = normalizeLogin(input.author, "author");
  if ("error" in authorResult) return { error: authorResult.error };
  if (repoResult.value && !ownerResult.value)
    return { error: "owner is required when repo is provided." };
  return {
    owner: ownerResult.value,
    repo: repoResult.value,
    author: authorResult.value,
  };
}

function buildSearchQuery(input: {
  owner: string | null;
  repo: string | null;
  author: string | null;
  ownerType: string;
  state: string;
  query?: string;
}): string {
  const terms = ["is:pr"];
  if (input.state !== "all") terms.push(`is:${input.state}`);
  if (input.repo && input.owner)
    terms.push(`repo:${input.owner}/${input.repo}`);
  else if (input.owner)
    terms.push(`${input.ownerType === "user" ? "user" : "org"}:${input.owner}`);
  if (input.author) terms.push(`author:${input.author}`);
  const extra = normalizeSearchText(input.query);
  if (extra) terms.push(extra);
  terms.push("sort:updated-desc");
  return terms.join(" ");
}

async function searchWithFallback(
  auths: GithubPrSearchAuth[],
  searchQuery: string,
  limit: number,
  warnings: string[]
) {
  let result: Awaited<ReturnType<typeof runGraphqlSearch>> | null = null;
  for (const [index, auth] of auths.entries()) {
    result = await runGraphqlSearch({ auth, searchQuery, limit });
    const hasNext = index < auths.length - 1;
    if (
      result.ok ||
      !hasNext ||
      !shouldRetryWithNextAuth({
        status: result.status,
        authFailed: "authFailed" in result ? result.authFailed : undefined,
        rateLimited: "rateLimited" in result ? result.rateLimited : undefined,
      })
    )
      break;
    warnings.push(
      retryWarning({
        source: result.auth.source,
        status: result.status,
        error: "error" in result ? result.error : undefined,
      })
    );
  }
  return result;
}

const prSearchParams = z
  .object({
    owner: z
      .string()
      .optional()
      .describe(
        "GitHub organization or user login to scope the search, e.g. 'webrenew'. Required when using GitHub App installation auth."
      ),
    ownerType: z
      .enum(["org", "user"])
      .default("org")
      .describe(
        "Whether owner is an organization or user. Use 'org' when the user says org."
      ),
    repo: z
      .string()
      .optional()
      .describe(
        "Optional repository name under owner. When provided, searches repo:owner/repo instead of all repos under owner."
      ),
    author: z
      .string()
      .optional()
      .describe("Optional GitHub username to filter PR author."),
    state: z
      .enum(["open", "closed", "all"])
      .default("open")
      .describe("Pull request state filter."),
    query: z
      .string()
      .optional()
      .describe(
        "Optional additional GitHub search terms or qualifiers. Do not include is:pr, state, author, org, user, repo, or is:draft qualifiers that are already represented by other inputs. Use draft:true or draft:false for draft filtering."
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum PRs to return."),
  })
  .strict();

export function createGithubPrSearch(options: GithubPrSearchOptions = {}) {
  return defineTool({
    description:
      "Search GitHub pull requests visible to the connected GitHub account, including private repositories covered by the user's OAuth token or the Mogplex GitHub App installation for the requested owner. Read-only. Use this for org-wide, user-wide, repo-wide, or 'my PRs' questions. Do not use public web search for GitHub PR inventory when this tool is available.",
    inputSchema: prSearchParams,
    execute: async ({
      owner,
      ownerType,
      repo,
      author,
      state,
      query,
      limit,
    }: z.infer<typeof prSearchParams>) => {
      const normalized = normalizeInputs({ owner, repo, author });
      if ("error" in normalized) return { error: normalized.error };
      const authResolution = await resolveAuthCandidates({
        oauthToken: options.oauthToken,
        userId: options.userId,
        owner: normalized.owner,
      });
      if ("error" in authResolution) return authResolution;
      const searchQuery = buildSearchQuery({
        ...normalized,
        ownerType: ownerType ?? "org",
        state: state ?? "open",
        query,
      });
      const warnings = [...authResolution.warnings];
      const result = await searchWithFallback(
        authResolution.auths,
        searchQuery,
        limit ?? 10,
        warnings
      );
      if (!result) return unavailableError(warnings);
      return warnings.length > 0 ? { ...result, warnings } : result;
    },
  });
}
