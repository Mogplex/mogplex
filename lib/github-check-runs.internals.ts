export const GITHUB_API_BASE = "https://api.github.com";

export type ParsedRepo = {
  owner: string;
  repo: string;
};

export type CheckRunResponse = {
  id?: number;
  html_url?: string | null;
};

export type PullRequestReviewResponse = {
  id?: number;
  html_url?: string | null;
};

export type IssueCommentResponse = {
  id?: number;
  html_url?: string | null;
  body?: string | null;
};

export type TimelineCommentMatch = IssueCommentResponse & {
  id: number;
  body: string;
};

type IssueCommentsPage = {
  comments: IssueCommentResponse[];
  lastPage: number;
};

export function parseRepoFullName(repoFullName: string): ParsedRepo {
  const [owner, repo] = repoFullName.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository name: ${repoFullName}`);
  }

  return { owner, repo };
}

export function getGithubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "mogplex",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function parseCheckRunResponse(
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

export async function parsePullRequestReviewResponse(response: Response) {
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

export async function parseIssueCommentResponse(
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

export function toCheckSummary(summary: string | null | undefined) {
  const trimmed = summary?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : "Mogplex completed the pull request review.";
}

export function toCheckText(text: string | null | undefined) {
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

export async function findExistingTimelineComment(
  input: {
    githubToken: string;
    owner: string;
    repo: string;
    prNumber: number;
  },
  marker: string
) {
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
          comment.body.includes(marker) &&
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
