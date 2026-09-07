import { supabaseAdmin } from "@/lib/supabase/admin";
import { WorktreeServiceError } from "./errors";
import type { OrchestrationWorktreeDTO } from "./types";

export async function claimArchivedWorktree(input: {
  worktreeId: string;
  userId: string;
  expectedUpdatedAt: string;
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_archived_worktree", {
    p_worktree_id: input.worktreeId,
    p_user_id: input.userId,
    p_expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) throw new Error(error.message);
  return data as string | null;
}

export async function releaseArchivedWorktree(input: {
  worktreeId: string;
  userId: string;
  token: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.rpc("release_archived_worktree", {
    p_worktree_id: input.worktreeId,
    p_user_id: input.userId,
    p_token: input.token,
  });
  if (error) throw new Error(error.message);
}

export async function withArchivedWorktreeClaim<T>(
  worktree: OrchestrationWorktreeDTO,
  deps: {
    claimArchived: typeof claimArchivedWorktree;
    releaseArchived: typeof releaseArchivedWorktree;
  },
  operation: () => Promise<T>
): Promise<T> {
  const input = { worktreeId: worktree.id, userId: worktree.user_id };
  const token = await deps.claimArchived({
    ...input,
    expectedUpdatedAt: worktree.updated_at,
  });
  if (!token) {
    throw new WorktreeServiceError(
      "Worktree changed or another operation is in progress; refresh and retry",
      { reason: "stale_resource" }
    );
  }
  try {
    return await operation();
  } finally {
    await deps.releaseArchived({ ...input, token });
  }
}
