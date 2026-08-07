/**
 * Context executor for automation jobs.
 *
 * Contains executeAutomationContext which runs the automation agent
 * for a resolved job context, with optional autofix and auto-merge.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import {
  INVALID_PR_REVIEW_CONTEXT,
  type JobContext,
} from "@/lib/workflows/automation-job-types";
import {
  normalizeAutomationAssignmentType,
  readAutomationTeamId,
} from "@/lib/workflows/automation-job-utils";
import { mergeAutomationAgentResults } from "@/lib/workflows/automation-job-metadata";
import { buildAutomationGatewayContext } from "@/lib/workflows/automation-job-agent-runners";
import { resolvePullRequestNumber } from "@/lib/workflows/automation-job-sandbox-actions";
import { extractPrReviewHarnessResult } from "@/lib/workflows/pr-review-harness";
import {
  type AutomationJobExecutorDeps,
  resolveAutomationModelForPhase,
} from "@/lib/workflows/automation-job-executor-deps";

/**
 * Execute the automation agent within a resolved job context.
 *
 * Handles model resolution, review agent execution, and optional
 * autofix agent execution for PR reviews with issues.
 */
export async function executeAutomationContext(input: {
  jobRunId: string;
  context: JobContext;
  githubToken: string;
  deps: AutomationJobExecutorDeps;
  allowAutofix?: boolean;
  autofixSandbox?: boolean;
  allowAutoMerge?: boolean;
}) {
  const assignmentType = normalizeAutomationAssignmentType(
    input.context.assignmentType
  );
  const resolvedModel = await resolveAutomationModelForPhase({
    deps: input.deps,
    userId: input.context.repo.user_id,
    modelId: input.context.agent.model,
    phase: `${assignmentType}:model_resolution`,
    timeoutMs: input.context.agent.timeout_ms,
    gatewayContext: buildAutomationGatewayContext(
      input.context,
      assignmentType
    ),
    teamId: readAutomationTeamId(input.context.metadata),
  });
  const prNumber =
    assignmentType === "pr_review"
      ? resolvePullRequestNumber(input.context.metadata)
      : null;

  if (assignmentType === "pr_review" && prNumber == null) {
    throw new Error(INVALID_PR_REVIEW_CONTEXT);
  }

  let result = await input.deps.runAutomationAgent(
    input.context,
    input.githubToken,
    resolvedModel
  );

  // Code mutation must be explicitly opted into. Legacy PR review jobs stay review-only.
  if (assignmentType !== "pr_review") {
    return result;
  }

  const reviewHarnessResult = extractPrReviewHarnessResult(result);
  const review =
    reviewHarnessResult.source === "structured"
      ? reviewHarnessResult.reviewOutcome
      : null;

  if (
    input.allowAutoMerge === true &&
    prNumber != null &&
    review !== null &&
    !review.hasIssues
  ) {
    // Don't merge here: the Mogplex PR Review check run for this head SHA is
    // still in_progress until finalizePrReviewSuccess completes it, so a repo
    // that requires that check would never report mergeable_state "clean".
    // The job success path performs the merge after the check run is
    // published (see attemptFlowAutoMerge).
    return { ...result, autoMergeRequest: { prNumber } };
  }

  if (input.allowAutofix !== true) {
    return result;
  }

  if (!review?.hasIssues || prNumber == null) {
    return result;
  }

  const pullRequest = await input.deps.loadPullRequestDetails({
    repoFullName: input.context.repo.full_name,
    prNumber,
    githubToken: input.githubToken,
    fallbackHeadRef:
      typeof input.context.metadata.head_ref === "string"
        ? input.context.metadata.head_ref
        : null,
    fallbackHeadSha:
      typeof input.context.metadata.head_sha === "string"
        ? input.context.metadata.head_sha
        : null,
    fallbackHeadRepoFullName:
      typeof input.context.metadata.head_repo_full_name === "string"
        ? input.context.metadata.head_repo_full_name
        : null,
    fallbackBaseRef:
      typeof input.context.metadata.base_ref === "string"
        ? input.context.metadata.base_ref
        : (input.context.repo.default_branch ?? null),
    fallbackBaseSha:
      typeof input.context.metadata.base_sha === "string"
        ? input.context.metadata.base_sha
        : null,
    fallbackBaseRepoFullName:
      typeof input.context.metadata.base_repo_full_name === "string"
        ? input.context.metadata.base_repo_full_name
        : input.context.repo.full_name,
  });

  if (!pullRequest) {
    return result;
  }

  const targetRepo = await input.deps.resolveAutofixTargetRepo({
    contextRepo: input.context.repo,
    headRepoFullName: pullRequest.headRepoFullName,
  });
  const autofixGithubToken = targetRepo
    ? await input.deps.resolveAutofixGithubToken(targetRepo, {
        jobRunId: input.jobRunId,
      })
    : null;

  if (!targetRepo || !autofixGithubToken) {
    return result;
  }

  const runFixAgent =
    input.autofixSandbox === true
      ? input.deps.runPRFixAgentInSandbox
      : input.deps.runPRFixAgent;

  const fixResult = await runFixAgent(
    {
      context: input.context,
      review,
      pullRequest,
      targetRepo,
    },
    autofixGithubToken,
    resolvedModel
  );

  result = mergeAutomationAgentResults([result, fixResult]);
  return result;
}
