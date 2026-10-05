import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  hasCapability,
  resolveMemberCapabilities,
} from "@/lib/team-capabilities";
import type {
  MergeApprovalTarget,
  MergePolicyDeps,
  TeamMergePolicy,
} from "./github-merge-policy";

export type MergeApprovalRequest = {
  id: string;
  target_owner: string;
  target_repo: string;
  pr_number: number;
  head_sha: string;
  commit_title: string;
  created_at: string;
};

export async function readTeamMergePolicy(
  teamId: string
): Promise<TeamMergePolicy | null> {
  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("github_merge_require_approval,github_merge_context_repo_only")
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    requireApproval: data.github_merge_require_approval === true,
    contextRepoOnly: data.github_merge_context_repo_only === true,
  };
}

export async function writeTeamMergePolicy(
  teamId: string,
  policy: TeamMergePolicy
) {
  const { data, error } = await supabaseAdmin
    .from("teams")
    .update({
      github_merge_require_approval: policy.requireApproval,
      github_merge_context_repo_only: policy.contextRepoOnly,
    })
    .eq("id", teamId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

function targetParams(input: MergeApprovalTarget) {
  return {
    p_user_id: input.userId,
    p_team_id: input.teamId,
    p_owner: input.owner.toLowerCase(),
    p_repo: input.repo.toLowerCase(),
    p_pr_number: input.number,
    p_head_sha: input.expectedHeadSha.toLowerCase(),
    p_commit_title: input.commitTitle ?? "",
  };
}

export const defaultMergePolicyDeps: MergePolicyDeps = {
  async read(userId, teamId) {
    const [policy, caps] = await Promise.all([
      readTeamMergePolicy(teamId),
      resolveMemberCapabilities(userId, teamId),
    ]);
    if (!policy || !hasCapability(caps, "tools.github_merge"))
      throw new Error("Merge permission unavailable");
    return policy;
  },
  async claimApproval(input) {
    const { data, error } = await supabaseAdmin.rpc(
      "claim_github_merge_approval",
      {
        ...targetParams(input),
        p_ai_call_id: input.aiCallId ?? null,
        p_request_id: input.requestId ?? null,
      }
    );
    if (error) throw new Error(error.message);
    return typeof data === "string" ? data : null;
  },
  async requestApproval(input) {
    const { data, error } = await supabaseAdmin.rpc(
      "request_github_merge_approval",
      {
        ...targetParams(input),
        p_ai_call_id: input.aiCallId ?? null,
        p_request_id: input.requestId ?? null,
      }
    );
    if (error) throw new Error(error.message);
    if (typeof data !== "string")
      throw new Error("No approval request returned");
    return data;
  },
};

export async function listMergeApprovals(
  userId: string,
  teamId: string
): Promise<MergeApprovalRequest[]> {
  const { data, error } = await supabaseAdmin
    .from("github_merge_approvals")
    .select(
      "id,target_owner,target_repo,pr_number,head_sha,commit_title,created_at"
    )
    .eq("user_id", userId)
    .eq("team_id", teamId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MergeApprovalRequest[];
}

export async function resolveMergeApproval(input: {
  userId: string;
  teamId: string;
  approvalId: string;
  approved: boolean;
}) {
  const { data, error } = await supabaseAdmin
    .from("github_merge_approvals")
    .update({
      status: input.approved ? "approved" : "denied",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", input.approvalId)
    .eq("user_id", input.userId)
    .eq("team_id", input.teamId)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length === 1;
}
