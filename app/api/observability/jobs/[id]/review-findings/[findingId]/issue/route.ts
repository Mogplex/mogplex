import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getOwnedRepoWithGithubAccessToken } from "@/lib/github-access";
import { createGithubIssue } from "@/lib/github-issues";
import {
  claimOwnedReviewFindingIssueCreation,
  markReviewFindingIssueCreated,
  releaseReviewFindingIssueCreationClaim,
} from "@/lib/review-findings";
import type { JobRunReviewFinding } from "@/lib/types";
import type { NextRequest } from "next/server";

type ReviewFindingRepoAccessRecord = {
  id: string;
  user_id: string;
  full_name: string;
  github_installation_id: number | null;
};

type ReviewFindingRepoAccessLoader = (
  repoId: string,
  userId: string
) => Promise<{
  repo: ReviewFindingRepoAccessRecord | null;
  githubToken: string | null;
}>;

type ReviewFindingIssueRouteDeps = {
  requireUserId: typeof requireUserId;
  claimOwnedReviewFindingIssueCreation: typeof claimOwnedReviewFindingIssueCreation;
  getOwnedRepoWithGithubAccessToken: ReviewFindingRepoAccessLoader;
  createGithubIssue: typeof createGithubIssue;
  markReviewFindingIssueCreated: typeof markReviewFindingIssueCreated;
  releaseReviewFindingIssueCreationClaim: typeof releaseReviewFindingIssueCreationClaim;
};

type IssueRouteRequestBody = {
  title?: string;
  body?: string;
  labels?: string[];
};

const defaultReviewFindingIssueRouteDeps: ReviewFindingIssueRouteDeps = {
  requireUserId,
  claimOwnedReviewFindingIssueCreation,
  getOwnedRepoWithGithubAccessToken: (repoId, userId) =>
    getOwnedRepoWithGithubAccessToken<ReviewFindingRepoAccessRecord>(
      repoId,
      userId,
      {
        select: "id, user_id, full_name, github_installation_id",
      }
    ),
  createGithubIssue,
  markReviewFindingIssueCreated,
  releaseReviewFindingIssueCreationClaim,
};

function formatSeverityLabel(severity: JobRunReviewFinding["severity"]) {
  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "suggestion":
      return "Suggestion";
  }
}

function buildDefaultIssueTitle(finding: JobRunReviewFinding) {
  return `[${formatSeverityLabel(finding.severity)}] ${finding.title}`;
}

function buildDefaultIssueBody(input: {
  finding: JobRunReviewFinding;
  repoFullName: string;
  jobRunId: string;
}) {
  const location = input.finding.path
    ? input.finding.line == null
      ? input.finding.path
      : `${input.finding.path}:L${input.finding.line}`
    : null;
  const prRef =
    input.finding.pr_number == null
      ? null
      : `#${input.finding.pr_number} in ${input.repoFullName}`;

  return [
    "## Mogplex Review Finding",
    "",
    `**Severity:** ${formatSeverityLabel(input.finding.severity)}`,
    ...(prRef ? [`**Pull request:** ${prRef}`] : []),
    ...(location ? [`**Location:** ${location}`] : []),
    `**Job run:** ${input.jobRunId}`,
    "",
    `### ${input.finding.title}`,
    "",
    input.finding.body,
  ].join("\n");
}

function toLabelList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is string => entry.length > 0)
    .slice(0, 10);
}

export function createReviewFindingIssuePostHandler(
  overrides: Partial<ReviewFindingIssueRouteDeps> = {}
) {
  const deps: ReviewFindingIssueRouteDeps = {
    ...defaultReviewFindingIssueRouteDeps,
    ...overrides,
  };

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; findingId: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id: jobRunId, findingId } = await params;
    const claim = await deps.claimOwnedReviewFindingIssueCreation({
      userId,
      jobRunId,
      findingId,
    });

    if (claim.outcome === "not_found") {
      return NextResponse.json(
        { error: "Review finding not found" },
        { status: 404 }
      );
    }

    if (claim.outcome === "linked") {
      const finding = claim.finding;
      return NextResponse.json({
        ok: true,
        created: false,
        issueNumber: finding.issue_number,
        issueUrl: finding.issue_url,
      });
    }

    if (claim.outcome === "busy") {
      const finding = claim.finding;
      const error =
        finding.status === "dismissed"
          ? "Review finding is dismissed"
          : finding.status === "issue_creating"
            ? "Issue creation is already in progress"
            : "Review finding is not open for issue creation";
      return NextResponse.json({ error }, { status: 409 });
    }

    const finding = claim.finding;
    let createdIssue: Awaited<
      ReturnType<typeof deps.createGithubIssue>
    > | null = null;

    const releaseClaim = async (issue?: {
      issueNumber: number;
      issueUrl: string | null;
    }) => {
      try {
        await deps.releaseReviewFindingIssueCreationClaim({
          findingId,
          issueNumber: issue?.issueNumber,
          issueUrl: issue?.issueUrl,
        });
        return true;
      } catch (error) {
        console.error("Failed to release review finding issue claim", {
          findingId,
          issueNumber: issue?.issueNumber ?? null,
          issueUrl: issue?.issueUrl ?? null,
          error:
            error instanceof Error ? error.message : "Unknown release error",
        });
        return false;
      }
    };

    if (!finding.repo_id) {
      await releaseClaim();
      return NextResponse.json(
        { error: "Review finding is not linked to a repository" },
        { status: 409 }
      );
    }

    const body = (await request
      .json()
      .catch(() => ({}))) as IssueRouteRequestBody;

    try {
      const { repo, githubToken } =
        await deps.getOwnedRepoWithGithubAccessToken(finding.repo_id, userId);

      if (!repo) {
        await releaseClaim();
        return NextResponse.json(
          { error: "Repository not found" },
          { status: 404 }
        );
      }

      if (!githubToken) {
        await releaseClaim();
        return NextResponse.json(
          { error: "GitHub access is not available for this repository" },
          { status: 409 }
        );
      }

      const title =
        typeof body.title === "string" && body.title.trim().length > 0
          ? body.title.trim()
          : buildDefaultIssueTitle(finding);
      const issueBody =
        typeof body.body === "string" && body.body.trim().length > 0
          ? body.body.trim()
          : buildDefaultIssueBody({
              finding,
              repoFullName: repo.full_name,
              jobRunId,
            });

      createdIssue = await deps.createGithubIssue({
        githubToken,
        repoFullName: repo.full_name,
        title,
        body: issueBody,
        labels: toLabelList(body.labels),
      });

      await deps.markReviewFindingIssueCreated({
        findingId,
        issueNumber: createdIssue.issueNumber,
        issueUrl: createdIssue.issueUrl,
      });
    } catch (error) {
      const claimReleased = await releaseClaim(
        createdIssue
          ? {
              issueNumber: createdIssue.issueNumber,
              issueUrl: createdIssue.issueUrl,
            }
          : undefined
      );

      if (createdIssue && claimReleased) {
        return NextResponse.json({
          ok: true,
          created: true,
          issueNumber: createdIssue.issueNumber,
          issueUrl: createdIssue.issueUrl,
        });
      }

      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to create review finding issue",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      created: true,
      issueNumber: createdIssue.issueNumber,
      issueUrl: createdIssue.issueUrl,
    });
  };
}

export const POST = createReviewFindingIssuePostHandler();
