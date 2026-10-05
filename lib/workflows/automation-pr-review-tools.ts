import { buildPRReviewTools } from "@/lib/agents/pr-reviewer";
import type { JobContext, FlowAutoMergeRequest } from "./automation-job-types";
import { finishPrReview } from "./pr-review-self-revision";
import { flowMergePolicyScope } from "./automation-job-auto-merge";
import { splitRepoFullName } from "./automation-job-utils";

/** Lifecycle permissions and review head come from the flow's server context. */
export function buildFlowPRReviewTools(
  context: JobContext,
  githubToken: string,
  prNumber: number,
  deferUntilReviewComplete: (target: FlowAutoMergeRequest) => void
) {
  const [owner, repo] = context.repo.full_name.split("/");
  const headParts = splitRepoFullName(
    typeof context.metadata.head_repo_full_name === "string"
      ? context.metadata.head_repo_full_name
      : context.repo.full_name
  ) ?? { owner, repo };
  return buildPRReviewTools({
    githubToken,
    owner,
    repo,
    prNumber,
    headOwner: headParts.owner,
    headRepo: headParts.repo,
    defaultRef:
      typeof context.metadata.head_ref === "string"
        ? context.metadata.head_ref
        : undefined,
    allowPostComment: false,
    allowPrLifecycle: context.metadata.flow_auto_merge === true,
    mergePolicyScope: {
      ...flowMergePolicyScope(context),
      deferUntilReviewComplete,
    },
    expectedHeadSha:
      typeof context.metadata.head_sha === "string"
        ? context.metadata.head_sha
        : undefined,
  });
}

export async function finishFlowPrReview(
  input: Parameters<typeof finishPrReview>[0],
  mergeRequest: () => FlowAutoMergeRequest | null
) {
  const review = await finishPrReview(input);
  const autoMergeRequest = mergeRequest();
  return { ...review, ...(autoMergeRequest ? { autoMergeRequest } : {}) };
}
