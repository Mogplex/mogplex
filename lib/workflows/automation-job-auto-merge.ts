import {
  mergePullRequestIfSafe,
  type AutoMergeOutcome,
} from "@/lib/github-merge";
import type { FlowGraph } from "@/lib/types";
import type {
  JobContext,
  PullRequestDetails,
} from "@/lib/workflows/automation-job-types";
import { loadPullRequestDetails } from "@/lib/workflows/automation-job-github";
import { resolvePullRequestNumber } from "@/lib/workflows/automation-job-sandbox-actions";
import type { ReviewOutcome } from "@/lib/workflows/pr-review-harness";

export function getPrReviewAutoMergeBlockReason(input: {
  reviewOutcome: Pick<ReviewOutcome, "hasIssues"> | null;
  requestedPrNumber: number;
  reviewedPrNumber: number | null;
}) {
  if (input.requestedPrNumber !== input.reviewedPrNumber) {
    return "Safe merge target does not match the reviewed pull request";
  }
  if (input.reviewOutcome?.hasIssues === false) return null;
  return input.reviewOutcome?.hasIssues === true
    ? "Mogplex review reported issues"
    : "Mogplex review did not produce a no-issues verdict";
}

export function resolveAutoMergeExpectedHeadSha(
  metadata: Record<string, unknown>,
  requestedPrNumber: number
) {
  if (resolvePullRequestNumber(metadata) !== requestedPrNumber) return null;
  return typeof metadata.head_sha === "string"
    ? metadata.head_sha.trim() || null
    : null;
}

export function getAutoMergeHeadBlockReason(
  metadata: Record<string, unknown>,
  requestedPrNumber: number,
  expectedHeadSha = resolveAutoMergeExpectedHeadSha(metadata, requestedPrNumber)
) {
  if (resolvePullRequestNumber(metadata) !== requestedPrNumber) return null;
  return expectedHeadSha
    ? null
    : "Triggering pull request head SHA is unavailable";
}

export async function hydrateFlowPullRequestHeadContext(input: {
  context: JobContext;
  githubToken: string;
  loadPullRequestDetails: typeof loadPullRequestDetails;
  refresh?: boolean;
}) {
  const prNumber = resolvePullRequestNumber(input.context.metadata);
  const existingHeadSha =
    typeof input.context.metadata.head_sha === "string"
      ? input.context.metadata.head_sha.trim()
      : "";
  if (prNumber == null || (existingHeadSha && input.refresh !== true)) {
    return input.context;
  }

  let pullRequest: PullRequestDetails | null;
  try {
    pullRequest = await input.loadPullRequestDetails({
      repoFullName: input.context.repo.full_name,
      prNumber,
      githubToken: input.githubToken,
      fallbackHeadRef: null,
      fallbackHeadSha: null,
      fallbackHeadRepoFullName: null,
      fallbackBaseRef: null,
      fallbackBaseSha: null,
      fallbackBaseRepoFullName: null,
    });
  } catch (error) {
    console.warn("[automation-job] failed to hydrate pull request head", {
      repoFullName: input.context.repo.full_name,
      prNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return input.context;
  }

  const headSha = pullRequest?.headSha?.trim();
  if (!pullRequest || !headSha) return input.context;
  return {
    ...input.context,
    metadata: {
      ...input.context.metadata,
      pr_number: prNumber,
      head_ref: pullRequest.headRef,
      head_sha: headSha,
      head_repo_full_name: pullRequest.headRepoFullName,
      base_ref: pullRequest.baseRef,
      base_sha: pullRequest.baseSha,
      base_repo_full_name: pullRequest.baseRepoFullName,
    },
  };
}

export function flowRequestsAutoMerge(graph: FlowGraph) {
  return graph.nodes.some(
    (node) =>
      (node.type === "agent" && node.data.autoMerge === true) ||
      (node.type === "action" &&
        node.data.operation === "github.merge_pull_request")
  );
}

export async function attemptFlowAutoMerge(input: {
  jobRunId: string;
  repoFullName: string;
  prNumber: number;
  githubToken: string;
  expectedHeadSha?: string | null;
  commitTitle?: string | null;
}): Promise<AutoMergeOutcome> {
  const [mergeOwner, mergeRepo] = input.repoFullName.split("/");
  let autoMerge: AutoMergeOutcome;
  try {
    autoMerge = await mergePullRequestIfSafe({
      githubToken: input.githubToken,
      owner: mergeOwner,
      repo: mergeRepo,
      prNumber: input.prNumber,
      ...(input.expectedHeadSha
        ? { expectedHeadSha: input.expectedHeadSha }
        : {}),
      ...(input.commitTitle ? { commitTitle: input.commitTitle } : {}),
    });
  } catch (error) {
    autoMerge = {
      merged: false,
      reason: `Auto-merge errored: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  console.log(
    JSON.stringify({
      event: "flow_auto_merge",
      job_run_id: input.jobRunId,
      repo_full_name: input.repoFullName,
      pr_number: input.prNumber,
      merged: autoMerge.merged,
      reason: autoMerge.reason,
    })
  );
  return autoMerge;
}
