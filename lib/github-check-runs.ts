const GITHUB_API_BASE = "https://api.github.com";

export const MOGPLEX_PR_REVIEW_CHECK_NAME = "Mogplex PR Review";
export const MOGPLEX_PR_REVIEW_RERUN_ACTION = "rerun-pr-review";
export const MOGPLEX_PR_REVIEW_TIMELINE_MARKER = "<!-- mogplex-pr-review -->";

type CheckRunConclusion = "success" | "neutral" | "failure";

type ParsedRepo = {
  owner: string;
  repo: string;
};

type CheckRunResponse = {
  id?: number;
  html_url?: string | null;
};

type PullRequestReviewResponse = {
  id?: number;
  html_url?: string | null;
};

type IssueCommentResponse = {
  id?: number;
  html_url?: string | null;
  body?: string | null;
};

type TimelineCommentMatch = IssueCommentResponse & {
  id: number;
  body: string;
};

type IssueCommentsPage = {
  comments: IssueCommentResponse[];
  lastPage: number;
};

function parseRepoFullName(repoFullName: string): ParsedRepo {
  const [owner, repo] = repoFullName.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository name: ${repoFullName}`);
  }

  return { owner, repo };
}

function getGithubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "mogplex",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function parseCheckRunResponse(
  response: Response,
  action: "create" | "update"
) {
  const payload = (await response.json().catch(() => null)) as
    | CheckRunResponse
    | { message?: string }
    | null;

  if (!response.ok) {
    const message =
      payload && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : response.statusText || "Unknown GitHub API error";
    throw new Error(
      `GitHub check run ${action} failed (${response.status}): ${message}`
    );
  }

  if (!payload || !("id" in payload) || typeof payload.id !== "number") {
    throw new Error(`GitHub check run ${action} failed: missing check run id`);
  }

  return {
    id: payload.id,
    htmlUrl:
      "html_url" in payload && typeof payload.html_url === "string"
        ? payload.html_url
        : null,
  };
}

async function parsePullRequestReviewResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | PullRequestReviewResponse
    | { message?: string }
    | null;

  if (!response.ok) {
    const message =
      payload && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : response.statusText || "Unknown GitHub API error";
    throw new Error(
      `GitHub PR review publish failed (${response.status}): ${message}`
    );
  }

  if (!payload || !("id" in payload) || typeof payload.id !== "number") {
    throw new Error("GitHub PR review publish failed: missing review id");
  }

  return {
    id: payload.id,
    htmlUrl:
      "html_url" in payload && typeof payload.html_url === "string"
        ? payload.html_url
        : null,
  };
}

async function parseIssueCommentResponse(
  response: Response,
  action: "create" | "update"
) {
  const payload = (await response.json().catch(() => null)) as
    | IssueCommentResponse
    | { message?: string }
    | null;

  if (!response.ok) {
    const message =
      payload && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : response.statusText || "Unknown GitHub API error";
    throw new Error(
      `GitHub PR timeline comment ${action} failed (${response.status}): ${message}`
    );
  }

  if (!payload || !("id" in payload) || typeof payload.id !== "number") {
    throw new Error(
      `GitHub PR timeline comment ${action} failed: missing comment id`
    );
  }

  return {
    id: payload.id,
    htmlUrl:
      "html_url" in payload && typeof payload.html_url === "string"
        ? payload.html_url
        : null,
  };
}

function toCheckSummary(summary: string | null | undefined) {
  const trimmed = summary?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : "Mogplex completed the pull request review.";
}

function toCheckText(text: string | null | undefined) {
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function buildIssueCommentsPageUrl(input: {
  owner: string;
  repo: string;
  prNumber: number;
  page: number;
}) {
  return `${GITHUB_API_BASE}/repos/${input.owner}/${input.repo}/issues/${input.prNumber}/comments?per_page=100&page=${input.page}`;
}

function parseLastPageFromLinkHeader(linkHeader: string | null) {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="last"/);
    if (!match) {
      continue;
    }

    try {
      const page = Number.parseInt(
        new URL(match[1]).searchParams.get("page") ?? "",
        10
      );
      if (Number.isFinite(page) && page > 0) {
        return page;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function listIssueCommentsPage(input: {
  githubToken: string;
  owner: string;
  repo: string;
  prNumber: number;
  page: number;
}): Promise<IssueCommentsPage> {
  const response = await fetch(
    buildIssueCommentsPageUrl({
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      page: input.page,
    }),
    {
      method: "GET",
      headers: getGithubHeaders(input.githubToken),
    }
  );

  const comments = (await response.json().catch(() => null)) as
    | IssueCommentResponse[]
    | { message?: string }
    | null;

  if (!response.ok) {
    const message =
      comments &&
      !Array.isArray(comments) &&
      typeof comments.message === "string"
        ? comments.message
        : response.statusText || "Unknown GitHub API error";
    throw new Error(
      `GitHub PR timeline comment lookup failed (${response.status}): ${message}`
    );
  }

  if (!Array.isArray(comments)) {
    throw new TypeError(
      "GitHub PR timeline comment lookup failed: invalid comments payload"
    );
  }

  return {
    comments,
    lastPage: parseLastPageFromLinkHeader(response.headers.get("link")) ?? 1,
  };
}

async function findExistingTimelineComment(input: {
  githubToken: string;
  owner: string;
  repo: string;
  prNumber: number;
}) {
  const firstPage = await listIssueCommentsPage({
    githubToken: input.githubToken,
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    page: 1,
  });

  // GitHub's per-issue comment listing is oldest-first, so walk backward from the
  // last page to find the newest canonical Mogplex comment with the fewest calls.
  for (let page = firstPage.lastPage; page >= 1; page -= 1) {
    const comments =
      page === 1
        ? firstPage.comments
        : (
            await listIssueCommentsPage({
              githubToken: input.githubToken,
              owner: input.owner,
              repo: input.repo,
              prNumber: input.prNumber,
              page,
            })
          ).comments;

    const matchingComment = [...comments]
      .reverse()
      .find(
        (comment): comment is TimelineCommentMatch =>
          typeof comment.body === "string" &&
          comment.body.includes(MOGPLEX_PR_REVIEW_TIMELINE_MARKER) &&
          typeof comment.id === "number"
      );

    if (matchingComment) {
      return {
        id: matchingComment.id,
        htmlUrl:
          typeof matchingComment.html_url === "string"
            ? matchingComment.html_url
            : null,
      };
    }
  }

  return null;
}

export function isMogplexPrReviewCheckName(name: string | null | undefined) {
  return (name ?? "").trim() === MOGPLEX_PR_REVIEW_CHECK_NAME;
}

export function isMogplexPrReviewRerunEvent(input: {
  action?: string | null;
  checkRunName?: string | null;
  requestedActionIdentifier?: string | null;
}) {
  if (!isMogplexPrReviewCheckName(input.checkRunName)) return false;

  if (input.action === "rerequested") return true;

  return (
    input.action === "requested_action" &&
    input.requestedActionIdentifier === MOGPLEX_PR_REVIEW_RERUN_ACTION
  );
}

export async function createPrReviewCheckRun(input: {
  githubToken: string;
  repoFullName: string;
  headSha: string;
  externalId: string;
  detailsUrl?: string | null;
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/check-runs`,
    {
      method: "POST",
      headers: getGithubHeaders(input.githubToken),
      body: JSON.stringify({
        name: MOGPLEX_PR_REVIEW_CHECK_NAME,
        head_sha: input.headSha,
        status: "in_progress",
        external_id: input.externalId,
        details_url: input.detailsUrl ?? undefined,
        output: {
          title: "Review in progress",
          summary: "Mogplex is reviewing this pull request.",
        },
      }),
    }
  );

  return parseCheckRunResponse(response, "create");
}

export async function completePrReviewCheckRun(input: {
  githubToken: string;
  repoFullName: string;
  checkRunId: number;
  conclusion: CheckRunConclusion;
  title: string;
  summary: string;
  text?: string | null;
  detailsUrl?: string | null;
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/check-runs/${input.checkRunId}`,
    {
      method: "PATCH",
      headers: getGithubHeaders(input.githubToken),
      body: JSON.stringify({
        status: "completed",
        conclusion: input.conclusion,
        completed_at: new Date().toISOString(),
        details_url: input.detailsUrl ?? undefined,
        output: {
          title: input.title,
          summary: toCheckSummary(input.summary),
          text: toCheckText(input.text),
        },
        actions: [
          {
            label: "Re-run review",
            description: "Queue another Mogplex review.",
            identifier: MOGPLEX_PR_REVIEW_RERUN_ACTION,
          },
        ],
      }),
    }
  );

  return parseCheckRunResponse(response, "update");
}

export async function createPrReviewGithubReview(input: {
  githubToken: string;
  repoFullName: string;
  prNumber: number;
  body: string;
  commitId?: string | null;
  comments?: Array<{
    path: string;
    body: string;
    line: number;
  }>;
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${input.prNumber}/reviews`,
    {
      method: "POST",
      headers: getGithubHeaders(input.githubToken),
      body: JSON.stringify({
        commit_id: input.commitId ?? undefined,
        body: input.body.trim(),
        event: "COMMENT",
        comments:
          input.comments?.map((comment) => ({
            path: comment.path,
            body: comment.body,
            line: comment.line,
            side: "RIGHT",
          })) ?? [],
      }),
    }
  );

  return parsePullRequestReviewResponse(response);
}

function withTimelineMarker(body: string) {
  // Prefix a hidden marker and newline so future runs can locate the canonical
  // comment with includes(marker) and update it instead of creating a new one.
  return `${MOGPLEX_PR_REVIEW_TIMELINE_MARKER}\n${body.trim()}`;
}

export async function upsertPrReviewTimelineComment(input: {
  githubToken: string;
  repoFullName: string;
  prNumber: number;
  body: string;
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const existingComment = await findExistingTimelineComment({
    githubToken: input.githubToken,
    owner,
    repo,
    prNumber: input.prNumber,
  });

  const body = withTimelineMarker(input.body);

  if (existingComment) {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/comments/${existingComment.id}`,
      {
        method: "PATCH",
        headers: getGithubHeaders(input.githubToken),
        body: JSON.stringify({ body }),
      }
    );

    const updated = await parseIssueCommentResponse(response, "update");
    return {
      id: updated.id,
      htmlUrl: updated.htmlUrl ?? existingComment.htmlUrl,
      created: false,
    };
  }

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${input.prNumber}/comments`,
    {
      method: "POST",
      headers: getGithubHeaders(input.githubToken),
      body: JSON.stringify({ body }),
    }
  );

  const created = await parseIssueCommentResponse(response, "create");
  return {
    id: created.id,
    htmlUrl: created.htmlUrl,
    created: true,
  };
}

export async function clearPrReviewTimelineComment(input: {
  githubToken: string;
  repoFullName: string;
  prNumber: number;
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const existingComment = await findExistingTimelineComment({
    githubToken: input.githubToken,
    owner,
    repo,
    prNumber: input.prNumber,
  });

  if (!existingComment) {
    return {
      deleted: false,
      id: null,
      htmlUrl: null,
    };
  }

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/comments/${existingComment.id}`,
    {
      method: "DELETE",
      headers: getGithubHeaders(input.githubToken),
    }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    const message =
      payload && typeof payload.message === "string"
        ? payload.message
        : response.statusText || "Unknown GitHub API error";
    throw new Error(
      `GitHub PR timeline comment delete failed (${response.status}): ${message}`
    );
  }

  return {
    deleted: true,
    id: existingComment.id,
    htmlUrl: existingComment.htmlUrl,
  };
}
