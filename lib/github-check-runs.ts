import {
  GITHUB_API_BASE,
  findExistingTimelineComment,
  getGithubHeaders,
  parseCheckRunResponse,
  parseIssueCommentResponse,
  parsePullRequestReviewResponse,
  parseRepoFullName,
  toCheckSummary,
  toCheckText,
} from "./github-check-runs.internals";

export const MOGPLEX_PR_REVIEW_CHECK_NAME = "Mogplex PR Review";
export const MOGPLEX_PR_REVIEW_RERUN_ACTION = "rerun-pr-review";
export const MOGPLEX_PR_REVIEW_TIMELINE_MARKER = "<!-- mogplex-pr-review -->";

type CheckRunConclusion = "success" | "neutral" | "failure";

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
  const existingComment = await findExistingTimelineComment(
    {
      githubToken: input.githubToken,
      owner,
      repo,
      prNumber: input.prNumber,
    },
    MOGPLEX_PR_REVIEW_TIMELINE_MARKER
  );

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
  const existingComment = await findExistingTimelineComment(
    {
      githubToken: input.githubToken,
      owner,
      repo,
      prNumber: input.prNumber,
    },
    MOGPLEX_PR_REVIEW_TIMELINE_MARKER
  );

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
