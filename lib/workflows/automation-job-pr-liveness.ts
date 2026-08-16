/**
 * Liveness checks and supersede handling for PR-sourced automation jobs.
 *
 * A PR that closes (or loses its head branch) between dispatch and execution
 * is superseded work, not a failure: the run is persisted as cancelled with a
 * PR_REVIEW_SUPERSEDED dispatch event instead of being failed. Checked twice —
 * once before execution starts (pre-flight) and again when a run fails with a
 * "git clone failed" error (the head branch vanished mid-run).
 */

import {
  formatAutomationReasonLabel,
  isPrReviewSourceType,
  PR_REVIEW_REASON_CODES,
} from "@/lib/automation-review";
import type { AutomationJobExecutorDeps } from "./automation-job-executor-deps";
import { resolvePullRequestNumber } from "./automation-job-sandbox-actions";
import {
  JOB_RUN_CANCELLED,
  type AutomationJobInput,
  type AutomationJobRunResult,
  type DispatchLogContext,
  type JobContext,
} from "./automation-job-types";

export type AutomationPrLivenessResult =
  | { alive: true }
  | { alive: false; reason: "pr_closed" | "head_branch_deleted" };

export type FetchAutomationPrLiveness = (input: {
  githubToken: string;
  baseRepoFullName: string;
  headRepoFullName: string;
  prNumber: number;
  headRef: string;
}) => Promise<AutomationPrLivenessResult>;

const GIT_CLONE_FAILED_PATTERN = /git clone failed/i;

/**
 * Check whether the PR behind a job still exists and is open.
 *
 * Fail-open by design: a missing pr_number/head_ref (not PR-sourced) or a
 * flaky GitHub read must never cancel real work, so both return alive.
 */
export async function checkAutomationPrLiveness(input: {
  context: JobContext;
  githubToken: string;
  fetchPrLiveness: FetchAutomationPrLiveness;
}): Promise<AutomationPrLivenessResult> {
  const prNumber = resolvePullRequestNumber(input.context.metadata);
  const headRef =
    typeof input.context.metadata.head_ref === "string"
      ? input.context.metadata.head_ref.trim()
      : "";
  if (prNumber == null || headRef.length === 0) {
    return { alive: true };
  }

  try {
    return await input.fetchPrLiveness({
      githubToken: input.githubToken,
      baseRepoFullName: input.context.repo.full_name,
      headRepoFullName:
        typeof input.context.metadata.head_repo_full_name === "string"
          ? input.context.metadata.head_repo_full_name
          : input.context.repo.full_name,
      prNumber,
      headRef,
    });
  } catch (error) {
    console.warn("[automation-job] PR liveness check failed; treating alive", {
      repoFullName: input.context.repo.full_name,
      prNumber,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { alive: true };
  }
}

export type SupersedeAutomationPrJobArgs = {
  deps: Pick<
    AutomationJobExecutorDeps,
    | "persistJobCancelled"
    | "recordControlDispatchEvent"
    | "releaseQueuedJobs"
    | "completePrReviewCheckRun"
    | "fetchPrLiveness"
  >;
  input: AutomationJobInput;
  context: JobContext;
  dispatchLogContext: DispatchLogContext;
  githubToken: string;
};

function buildSupersedeCancelReason(
  args: SupersedeAutomationPrJobArgs,
  reason: "pr_closed" | "head_branch_deleted"
) {
  if (reason === "pr_closed") {
    const prNumber = resolvePullRequestNumber(args.context.metadata);
    return `PR #${prNumber ?? "?"} was closed before the review completed`;
  }
  const headRef =
    typeof args.context.metadata.head_ref === "string"
      ? args.context.metadata.head_ref
      : "unknown";
  return `PR head branch ${headRef} was deleted`;
}

/**
 * Persist a superseded PR job run as cancelled, record the control dispatch
 * event, neutrally complete any pending review check run, and release the
 * queue. Returns the JOB_RUN_CANCELLED result the trigger task treats as a
 * non-failure.
 */
export async function supersedeAutomationPrJob(
  args: SupersedeAutomationPrJobArgs,
  reason: "pr_closed" | "head_branch_deleted",
  reviewCheckRunId: number | null
): Promise<AutomationJobRunResult> {
  const cancelReason = buildSupersedeCancelReason(args, reason);
  const now = new Date().toISOString();

  await args.deps.persistJobCancelled({
    jobRunId: args.input.jobRunId,
    cancelRequestedAt: now,
    cancelledAt: now,
    reason: cancelReason,
    cancelError: null,
  });

  await args.deps.recordControlDispatchEvent({
    context: args.dispatchLogContext,
    jobRunId: args.input.jobRunId,
    outcome: "cancelled",
    reason: PR_REVIEW_REASON_CODES.superseded,
    metadata: {
      review_outcome: PR_REVIEW_REASON_CODES.superseded,
      review_outcome_label: formatAutomationReasonLabel(
        PR_REVIEW_REASON_CODES.superseded
      ),
      cancel_reason: cancelReason,
    },
  });

  if (reviewCheckRunId != null) {
    try {
      await args.deps.completePrReviewCheckRun({
        githubToken: args.githubToken,
        repoFullName: args.context.repo.full_name,
        checkRunId: reviewCheckRunId,
        conclusion: "neutral",
        title: "Review superseded",
        summary: cancelReason,
      });
    } catch {
      // Best-effort: a stuck pending check is cosmetic next to the lost PR.
    }
  }

  await args.deps.releaseQueuedJobs({
    jobRunId: args.input.jobRunId,
    releasedScope: args.input.releasedScope,
  });

  return { success: false, error: JOB_RUN_CANCELLED };
}

/**
 * Supersede the job when its PR vanished, otherwise return null so the caller
 * falls through to its normal path.
 *
 * - With no `message` (pre-flight), any dead PR supersedes the job.
 * - With a `message` (failure path), only "git clone failed" failures qualify
 *   — other failures stay failures even when the PR is dead.
 */
export async function supersedeIfVanishedPr(
  args: SupersedeAutomationPrJobArgs,
  options: { message?: string | null; reviewCheckRunId?: number | null } = {}
): Promise<AutomationJobRunResult | null> {
  if (!isPrReviewSourceType(args.dispatchLogContext.sourceType)) {
    return null;
  }
  if (
    options.message != null &&
    !GIT_CLONE_FAILED_PATTERN.test(options.message)
  ) {
    return null;
  }

  const liveness = await checkAutomationPrLiveness({
    context: args.context,
    githubToken: args.githubToken,
    fetchPrLiveness: args.deps.fetchPrLiveness,
  });
  if (liveness.alive) {
    return null;
  }

  return supersedeAutomationPrJob(
    args,
    liveness.reason,
    options.reviewCheckRunId ?? null
  );
}
