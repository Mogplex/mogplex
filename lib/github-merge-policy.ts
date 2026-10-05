export type TeamMergePolicy = {
  requireApproval: boolean;
  contextRepoOnly: boolean;
};

export type MergeApprovalTarget = {
  userId: string;
  teamId: string;
  owner: string;
  repo: string;
  number: number;
  expectedHeadSha: string;
  commitTitle?: string;
  aiCallId?: string | null;
  requestId?: string | null;
};

export type MergePolicyDeps = {
  read: (userId: string, teamId: string) => Promise<TeamMergePolicy>;
  claimApproval: (input: MergeApprovalTarget) => Promise<string | null>;
  requestApproval: (input: MergeApprovalTarget) => Promise<string>;
};

export type MergePolicyDecision =
  | { allowed: true; approvalId?: string; immediateOnly?: true }
  | {
      allowed: false;
      decision:
        | "approval_required"
        | "outside_context_repo"
        | "immediate_merge_required"
        | "merge_deferred"
        | "merge_policy_unavailable";
      error: string;
      approvalId?: string;
    };

/** Runs inside execute, so direct MCP calls cannot bypass a UI-only gate. */
export async function enforceMergePolicy(
  input: MergeApprovalTarget,
  contextRepo: { owner?: string; repo?: string } | undefined,
  deps: MergePolicyDeps,
  mode: "merge" | "queue" | "review" = "merge"
): Promise<MergePolicyDecision> {
  try {
    const policy = await deps.read(input.userId, input.teamId);
    if (
      policy.contextRepoOnly &&
      (contextRepo?.owner?.toLowerCase() !== input.owner.toLowerCase() ||
        contextRepo?.repo?.toLowerCase() !== input.repo.toLowerCase())
    ) {
      return {
        allowed: false,
        decision: "outside_context_repo",
        error:
          "This team allows agent merges only in the run's repository. Start the run from the target repository.",
      };
    }
    if (!policy.requireApproval) return { allowed: true };
    if (mode === "review") {
      return {
        allowed: false,
        decision: "merge_deferred",
        error:
          "This team's approved merge must wait for the review check to complete. Mogplex will request approval or merge the approved head after this flow finishes its review. Do not retry or poll.",
      };
    }
    if (mode === "queue") {
      return {
        allowed: false,
        decision: "immediate_merge_required",
        error:
          "This team approves one exact head for a direct merge. Auto-merge can remain enabled after a new push. Use the direct merge tool when checks and reviews have passed.",
      };
    }
    if (!/^[a-f\d]{40}$/i.test(input.expectedHeadSha)) {
      return {
        allowed: false,
        decision: "merge_policy_unavailable",
        error:
          "The reviewed head SHA is unavailable. Review the current head before requesting merge approval.",
      };
    }
    const approvalId = await deps.claimApproval(input);
    if (approvalId) return { allowed: true, approvalId, immediateOnly: true };
    return {
      allowed: false,
      decision: "approval_required",
      approvalId: await deps.requestApproval(input),
      error:
        "This team requires your approval before an agent merges a pull request. Review this request in Team settings > Members > Agent merges, then ask the agent to continue. After approval, use the same repository, pull request, head SHA, and exact commit title; omit the title again if it was omitted. Do not retry or poll while approval is pending.",
    };
  } catch {
    return {
      allowed: false,
      decision: "merge_policy_unavailable",
      error:
        "Mogplex could not check this team's merge permissions or approval. No merge was started. Try again after the setting is available.",
    };
  }
}
