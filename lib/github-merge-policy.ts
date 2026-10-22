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
};

export type MergePolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      decision: "merge_deferred" | "merge_policy_unavailable";
      error: string;
    };

/** Recheck live team capability; retired approval/context settings are ignored. */
export async function enforceMergePolicy(
  input: MergeApprovalTarget,
  _contextRepo: { owner?: string; repo?: string } | undefined,
  deps: MergePolicyDeps,
  mode: "merge" | "queue" | "review" = "merge"
): Promise<MergePolicyDecision> {
  try {
    await deps.read(input.userId, input.teamId);
    if (mode === "review") {
      return {
        allowed: false,
        decision: "merge_deferred",
        error:
          "The merge will continue after this flow finishes publishing its review check. Do not retry or poll.",
      };
    }
    return { allowed: true };
  } catch {
    return {
      allowed: false,
      decision: "merge_policy_unavailable",
      error:
        "Mogplex could not verify your team's merge permission. No merge was started.",
    };
  }
}
