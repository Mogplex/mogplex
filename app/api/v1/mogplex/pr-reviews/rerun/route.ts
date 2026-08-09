import { resolveApiKey } from "@/lib/auth/api-key";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import {
  getLatestPrReviewCheckRun,
  getPullRequestHeadSha,
  MOGPLEX_PR_REVIEW_CHECK_NAME,
} from "@/lib/github-check-runs";
import {
  enqueueJobRunRetry,
  getDefaultJobRunRetryVersionMode,
  isJobRunRetryVersionError,
  loadJobRunRetryContext,
  type JobRunRetryContext,
} from "@/lib/job-run-retry";
import {
  listMogplexApiRepos,
  type MogplexApiRepo,
} from "@/lib/mogplex-api/repos";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import {
  serializeAutomationJobStart,
  startAutomationJobRun,
} from "@/lib/workflows/automation-job-workflow";
import type { NextRequest } from "next/server";

type PrReviewRerunRouteDeps = {
  resolveApiKey: typeof resolveApiKey;
  loadRepo: (userId: string, repoId: string) => Promise<MogplexApiRepo | null>;
  loadGithubAccessToken: (
    repo: MogplexApiRepo,
    userId: string
  ) => Promise<string | null>;
  getPullRequestHeadSha: typeof getPullRequestHeadSha;
  getLatestPrReviewCheckRun: typeof getLatestPrReviewCheckRun;
  loadJobRunRetryContext: (
    jobRunId: string
  ) => Promise<JobRunRetryContext | null>;
  enqueueJobRunRetry: typeof enqueueJobRunRetry;
  startAutomationJobRun: typeof startAutomationJobRun;
};

const defaults: PrReviewRerunRouteDeps = {
  resolveApiKey,
  loadRepo: async (userId, repoId) => {
    const repos = await listMogplexApiRepos(userId, { id: repoId, limit: 1 });
    return repos[0] ?? null;
  },
  loadGithubAccessToken: (repo, userId) =>
    getGithubAccessTokenForRepo(
      { user_id: userId, github_installation_id: repo.installation_id },
      userId
    ),
  getPullRequestHeadSha,
  getLatestPrReviewCheckRun,
  loadJobRunRetryContext,
  enqueueJobRunRetry,
  startAutomationJobRun,
};

export function createMogplexApiPrReviewRerunPostHandler(
  overrides: Partial<PrReviewRerunRouteDeps> = {}
) {
  const deps = { ...defaults, ...overrides };

  return async function POST(request: NextRequest) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return mogplexApiError("BAD_REQUEST", "Invalid JSON body", 400);
    }
    const repoId = typeof body.repoId === "string" ? body.repoId.trim() : "";
    if (!repoId) {
      return mogplexApiError(
        "BAD_REQUEST",
        "repoId must be a non-empty string",
        400
      );
    }
    const prNumber = body.prNumber;
    if (
      typeof prNumber !== "number" ||
      !Number.isSafeInteger(prNumber) ||
      prNumber <= 0
    ) {
      return mogplexApiError(
        "BAD_REQUEST",
        "prNumber must be a positive integer",
        400
      );
    }

    try {
      const repo = await deps.loadRepo(user.userId, repoId);
      if (!repo) {
        return mogplexApiError("NOT_FOUND", "Repository not found", 404);
      }

      const githubToken = await deps.loadGithubAccessToken(repo, user.userId);
      if (!githubToken) {
        return mogplexApiError(
          "CONFLICT",
          "No GitHub access token is available for this repository",
          409
        );
      }

      const headSha = await deps.getPullRequestHeadSha({
        githubToken,
        repoFullName: repo.full_name,
        prNumber,
      });
      if (!headSha) {
        return mogplexApiError(
          "NOT_FOUND",
          `Pull request #${prNumber} was not found in ${repo.full_name}`,
          404
        );
      }

      const checkRun = await deps.getLatestPrReviewCheckRun({
        githubToken,
        repoFullName: repo.full_name,
        headSha,
      });
      if (!checkRun) {
        return mogplexApiError(
          "NOT_FOUND",
          `No ${MOGPLEX_PR_REVIEW_CHECK_NAME} check run found for PR #${prNumber}`,
          404
        );
      }
      if (!checkRun.externalId) {
        return mogplexApiError(
          "CONFLICT",
          `The latest ${MOGPLEX_PR_REVIEW_CHECK_NAME} check run for PR #${prNumber} is not linked to a Mogplex run`,
          409
        );
      }

      const retryContext = await deps.loadJobRunRetryContext(
        checkRun.externalId
      );
      if (retryContext?.repoId !== repo.id) {
        return mogplexApiError(
          "NOT_FOUND",
          "Job run does not belong to this repository",
          404
        );
      }

      // Interactive retry: no idempotencyKey so each API call is a distinct
      // attempt, matching the GitHub check run "Re-run review" button.
      const requestedVersionMode =
        getDefaultJobRunRetryVersionMode(retryContext);
      const metadataPatch = {
        review_check_run_id: checkRun.id,
        review_check_run_rerun_requested: true,
        review_check_run_external_job_run_id: checkRun.externalId,
        review_check_run_rerun_source: "api",
      };
      let versionFallbackUsed = false;
      let enqueueResult: Awaited<ReturnType<typeof enqueueJobRunRetry>>;

      try {
        enqueueResult = await deps.enqueueJobRunRetry({
          retryContext,
          idempotencyKeyPrefix: `pr-review-rerun:${checkRun.id ?? "unknown"}`,
          versionMode: requestedVersionMode,
          metadataPatch,
        });
      } catch (error) {
        if (
          !isJobRunRetryVersionError(error) ||
          requestedVersionMode !== "latest_published"
        ) {
          throw error;
        }
        versionFallbackUsed = true;
        enqueueResult = await deps.enqueueJobRunRetry({
          retryContext,
          idempotencyKeyPrefix: `pr-review-rerun:${checkRun.id ?? "unknown"}`,
          versionMode: "same_version",
          metadataPatch: {
            ...metadataPatch,
            retry_latest_published_unavailable: true,
          },
        });
      }

      if (!enqueueResult.jobRunId || enqueueResult.outcome !== "queued") {
        return mogplexApiError(
          "CONFLICT",
          `The review retry was not queued${enqueueResult.reason ? `: ${enqueueResult.reason}` : ""}`,
          409
        );
      }

      const started = await deps.startAutomationJobRun(
        enqueueResult.jobRunId,
        "manual_retry"
      );
      const serializedStart = serializeAutomationJobStart(started);

      return mogplexApiSuccess({
        queued: true,
        jobRunId: enqueueResult.jobRunId,
        prNumber,
        repoId: repo.id,
        ...serializedStart,
        reason: serializedStart.reason ?? enqueueResult.reason,
        versionFallbackUsed,
      });
    } catch (error) {
      console.error("[mogplex-api/pr-reviews] rerun failed", error);
      return mogplexApiError(
        "INTERNAL_ERROR",
        "Failed to rerun the Mogplex PR review",
        500
      );
    }
  };
}

export const POST = createMogplexApiPrReviewRerunPostHandler();
