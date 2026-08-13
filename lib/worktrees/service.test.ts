import { describe, expect, it, vi } from "vitest";
import { archiveWorktree, spawnWorktree } from "./service";
import type { OrchestrationWorktreeDTO, WorktreeTaskContext } from "./types";

const IDS = {
  worktree: "11111111-2222-4333-8444-555555555555",
  run: "22222222-2222-4222-8222-222222222222",
  task: "33333333-3333-4333-8333-333333333333",
  repo: "44444444-4444-4444-8444-444444444444",
  sandbox: "55555555-5555-4555-8555-555555555555",
};

function task(): WorktreeTaskContext {
  return {
    id: IDS.task,
    run_id: IDS.run,
    repo_id: IDS.repo,
    branch_name: "mogplex/task/fix-login",
    base_branch: "main",
    agent_id: null,
    run: { id: IDS.run, user_id: "user-1", repo_id: IDS.repo },
  };
}

function worktree(
  status: OrchestrationWorktreeDTO["status"]
): OrchestrationWorktreeDTO {
  return {
    id: IDS.worktree,
    user_id: "user-1",
    run_id: IDS.run,
    task_id: IDS.task,
    repo_id: IDS.repo,
    sandbox_id: IDS.sandbox,
    agent_id: null,
    branch_name: "mogplex/task/fix-login",
    base_branch: "main",
    checkout_path: `/vercel/sandbox/.worktrees/${IDS.worktree}`,
    status,
    latest_commit_sha: null,
    error: null,
    metadata: {},
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
    archived_at: null,
    pruned_at: null,
  };
}

const input = {
  userId: "user-1",
  runId: IDS.run,
  taskId: IDS.task,
  sandboxId: IDS.sandbox,
};

describe("spawnWorktree reservation recovery", () => {
  it("returns a fresh concurrent reservation without duplicating git work", async () => {
    const execute = vi.fn();
    const creating = worktree("creating");
    const result = await spawnWorktree(input, {
      loadTask: async () => task(),
      findLiveForTask: async () => creating,
      loadSandbox: async () => ({
        id: IDS.sandbox,
        repo_id: IDS.repo,
        status: "running",
      }),
      reclaimCreating: async () => null,
      execute,
    });
    expect(result).toBe(creating);
    expect(execute).not.toHaveBeenCalled();
  });

  it("resumes git work only after atomically reclaiming a stale reservation", async () => {
    const creating = worktree("creating");
    const execute = vi.fn(async () => ({
      exitCode: 0,
      stdout: `MOGPLEX_WORKTREE_PATH=${creating.checkout_path}\n`,
      stderr: "",
    }));
    const active = worktree("active");
    const result = await spawnWorktree(input, {
      loadTask: async () => task(),
      findLiveForTask: async () => creating,
      loadSandbox: async () => ({
        id: IDS.sandbox,
        repo_id: IDS.repo,
        status: "running",
      }),
      reclaimCreating: async () => creating,
      execute,
      activate: async () => active,
      markError: async () => undefined,
    });
    expect(result).toBe(active);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("lets an operator archive a stuck creating reservation", async () => {
    const archived = worktree("archived");
    await expect(
      archiveWorktree(
        {
          userId: "user-1",
          worktreeId: IDS.worktree,
          runId: IDS.run,
          repoId: IDS.repo,
        },
        {
          load: async () => worktree("creating"),
          archive: async () => archived,
        }
      )
    ).resolves.toBe(archived);
  });
});
