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

export async function getPullRequestHeadSha(input: {
  githubToken: string;
  repoFullName: string;
  prNumber: number;
}): Promise<string | null> {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${input.prNumber}`,
    { headers: getGithubHeaders(input.githubToken) }
  );
  const payload = (await response.json().catch(() => null)) as {
    head?: { sha?: unknown };
    message?: string;
  } | null;

  if (response.status === 404) return null;
  if (!response.ok) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : response.statusText || "Unknown GitHub API error";
    throw new Error(
      `GitHub pull request lookup failed (${response.status}): ${message}`
    );
  }

  const sha = payload?.head?.sha;
  return typeof sha === "string" && sha.trim() ? sha : null;
}

export async function getLatestPrReviewCheckRun(input: {
  githubToken: string;
  repoFullName: string;
  headSha: string;
}): Promise<{ id: number | null; externalId: string | null } | null> {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${input.headSha}/check-runs?check_name=${encodeURIComponent(MOGPLEX_PR_REVIEW_CHECK_NAME)}&per_page=1`,
    { headers: getGithubHeaders(input.githubToken) }
  );
  const payload = (await response.json().catch(() => null)) as {
    check_runs?: Array<{ id?: unknown; external_id?: unknown }>;
    message?: string;
  } | null;

  if (!response.ok) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : response.statusText || "Unknown GitHub API error";
    throw new Error(
      `GitHub check runs lookup failed (${response.status}): ${message}`
    );
  }

  const checkRun = payload?.check_runs?.[0];
  if (!checkRun) return null;

  return {
    id: typeof checkRun.id === "number" ? checkRun.id : null,
    externalId:
      typeof checkRun.external_id === "string" && checkRun.external_id.trim()
        ? checkRun.external_id.trim()
        : null,
  };
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
