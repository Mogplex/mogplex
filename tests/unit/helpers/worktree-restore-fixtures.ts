import type {
  OrchestrationWorktreeDTO,
  WorktreeTaskContext,
} from "../../../lib/worktrees/types";

export const WORKTREE_ID = "11111111-2222-4333-8444-555555555555";
export const RUN_ID = "22222222-2222-4222-8222-222222222222";
export const TASK_ID = "33333333-3333-4333-8333-333333333333";
export const REPO_ID = "44444444-4444-4444-8444-444444444444";
export const SANDBOX_ID = "55555555-5555-4555-8555-555555555555";
// Unit tests own their database snapshots; the archived lease is a separate
// database boundary, so it is granted unconditionally here.
export const ARCHIVED_LEASE = {
  claimArchived: async () => "test-claim",
  releaseArchived: async () => undefined,
};

export function buildTask(): WorktreeTaskContext {
  return {
    id: TASK_ID,
    run_id: RUN_ID,
    repo_id: REPO_ID,
    branch_name: "mogplex/task/fix-login",
    base_branch: "main",
    agent_id: null,
    run: { id: RUN_ID, user_id: "user-1", repo_id: REPO_ID },
  };
}

export function buildWorktree(
  overrides: Partial<OrchestrationWorktreeDTO> = {}
): OrchestrationWorktreeDTO {
  return {
    id: WORKTREE_ID,
    user_id: "user-1",
    run_id: RUN_ID,
    task_id: TASK_ID,
    repo_id: REPO_ID,
    sandbox_id: SANDBOX_ID,
    agent_id: null,
    branch_name: "mogplex/task/fix-login",
    base_branch: "main",
    checkout_path: `/vercel/sandbox/.worktrees/${WORKTREE_ID}`,
    status: "active",
    latest_commit_sha: null,
    error: null,
    metadata: {},
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
    archived_at: null,
    pruned_at: null,
    ...overrides,
  };
}
