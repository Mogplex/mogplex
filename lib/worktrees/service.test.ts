import { describe, expect, it, vi } from "vitest";
import { WorktreeExecutorError } from "./executor";
import { archiveWorktree, pruneWorktree, spawnWorktree } from "./service";
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

  it("maps a concurrent reservation in another sandbox to a conflict", async () => {
    const execute = vi.fn();
    await expect(
      spawnWorktree(input, {
        loadTask: async () => task(),
        findLiveForTask: async () => null,
        loadSandbox: async () => ({
          id: IDS.sandbox,
          repo_id: IDS.repo,
          status: "running",
        }),
        reserve: async () => ({
          worktree: {
            ...worktree("creating"),
            sandbox_id: "66666666-6666-4666-8666-666666666666",
          },
          created: false,
        }),
        execute,
      })
    ).rejects.toMatchObject({
      name: "WorktreeServiceError",
      message: "Worktree is already reserved in another sandbox",
      kind: "conflict",
      reason: "sandbox_mismatch",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("resumes git work only after atomically reclaiming a stale reservation", async () => {
    const creating = {
      ...worktree("creating"),
      checkout_path: `/.reserved/.worktrees/${IDS.worktree}`,
    };
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
      recordMaterialized: async ({ checkoutPath }) => ({
        ...creating,
        checkout_path: checkoutPath,
      }),
      activate: async () => active,
      markError: async () => undefined,
    });
    expect(result).toBe(active);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reactivates an atomically claimed materialized checkout without recreating it", async () => {
    const failed = worktree("error");
    const claimed = { ...failed, status: "creating" as const };
    const execute = vi.fn();
    const active = worktree("active");
    await expect(
      spawnWorktree(input, {
        loadTask: async () => task(),
        findLiveForTask: async () => failed,
        loadSandbox: async () => ({
          id: IDS.sandbox,
          repo_id: IDS.repo,
          status: "running",
        }),
        claimError: async () => claimed,
        execute,
        activate: async () => active,
        markError: async () => undefined,
      })
    ).resolves.toBe(active);
    expect(execute).not.toHaveBeenCalled();
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

  it("does not archive a creation that still owns its live lease", async () => {
    const archive = vi.fn();
    await expect(
      archiveWorktree(
        {
          userId: "user-1",
          worktreeId: IDS.worktree,
          runId: IDS.run,
          repoId: IDS.repo,
        },
        {
          load: async () => ({
            ...worktree("creating"),
            updated_at: new Date().toISOString(),
          }),
          archive,
        }
      )
    ).rejects.toThrow("Wait for worktree creation to finish");
    expect(archive).not.toHaveBeenCalled();
  });

  it("maps a concurrent archive change to a retryable conflict", async () => {
    await expect(
      archiveWorktree(
        {
          userId: "user-1",
          worktreeId: IDS.worktree,
          runId: IDS.run,
          repoId: IDS.repo,
        },
        {
          load: async () => worktree("active"),
          archive: async () => null,
        }
      )
    ).rejects.toMatchObject({
      name: "WorktreeServiceError",
      message: "Worktree changed; refresh and retry",
      kind: "conflict",
      reason: "stale_resource",
    });
  });

  it("offers force retirement only when an archived sandbox is gone", async () => {
    const archived = worktree("archived");
    await expect(
      pruneWorktree(
        {
          userId: "user-1",
          worktreeId: IDS.worktree,
          runId: IDS.run,
          repoId: IDS.repo,
        },
        {
          load: async () => archived,
          execute: async () => {
            throw new WorktreeExecutorError(
              "Sandbox not found",
              404,
              "sandbox_not_found"
            );
          },
        }
      )
    ).rejects.toMatchObject({
      message: "Sandbox not found",
      forceEligible: true,
      reason: "sandbox_not_found",
    });
  });

  it("does not offer force retirement for ordinary git failures", async () => {
    await expect(
      pruneWorktree(
        {
          userId: "user-1",
          worktreeId: IDS.worktree,
          runId: IDS.run,
          repoId: IDS.repo,
        },
        {
          load: async () => worktree("archived"),
          execute: async () => ({
            exitCode: 1,
            stdout: "",
            stderr: "checkout contains modified files",
          }),
        }
      )
    ).rejects.toMatchObject({
      message: "checkout contains modified files",
      forceEligible: false,
    });
  });

  it("force-retires only after confirming the sandbox is missing", async () => {
    const pruned = worktree("pruned");
    const markPruned = vi.fn(async () => pruned);
    await expect(
      pruneWorktree(
        {
          userId: "user-1",
          worktreeId: IDS.worktree,
          runId: IDS.run,
          repoId: IDS.repo,
          force: true,
        },
        {
          load: async () => worktree("archived"),
          execute: async () => {
            throw new WorktreeExecutorError(
              "Sandbox not found",
              404,
              "sandbox_not_found"
            );
          },
          markPruned,
        }
      )
    ).resolves.toBe(pruned);
    expect(markPruned).toHaveBeenCalledOnce();
  });

  it("does not force-retire on executor failures from a live sandbox", async () => {
    const markPruned = vi.fn();
    await expect(
      pruneWorktree(
        {
          userId: "user-1",
          worktreeId: IDS.worktree,
          runId: IDS.run,
          repoId: IDS.repo,
          force: true,
        },
        {
          load: async () => worktree("archived"),
          execute: async () => {
            throw new WorktreeExecutorError("Executor unavailable", 503);
          },
          markPruned,
        }
      )
    ).rejects.toThrow("Executor unavailable");
    expect(markPruned).not.toHaveBeenCalled();
  });

  it("checks for a crash-window checkout before pruning a reservation", async () => {
    const execute = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));
    const pruned = worktree("pruned");
    await expect(
      pruneWorktree(
        {
          userId: "user-1",
          worktreeId: IDS.worktree,
          runId: IDS.run,
          repoId: IDS.repo,
        },
        {
          load: async () => ({
            ...worktree("archived"),
            checkout_path: `/.reserved/.worktrees/${IDS.worktree}`,
          }),
          execute,
          markPruned: async () => pruned,
        }
      )
    ).resolves.toBe(pruned);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxId: IDS.sandbox,
        command: expect.stringContaining(
          `checkout_path="$repo_root/.worktrees/$MOGPLEX_WORKTREE_ID"`
        ),
      })
    );
  });

  it("does not force-retire a binding for an untyped executor 404", async () => {
    const markPruned = vi.fn();
    await expect(
      pruneWorktree(
        {
          userId: "user-1",
          worktreeId: IDS.worktree,
          runId: IDS.run,
          repoId: IDS.repo,
          force: true,
        },
        {
          load: async () => worktree("archived"),
          execute: async () => {
            throw new WorktreeExecutorError("Route not found", 404);
          },
          markPruned,
        }
      )
    ).rejects.toThrow("Route not found");
    expect(markPruned).not.toHaveBeenCalled();
  });

  it("classifies invented task and inactive sandbox failures", async () => {
    await expect(
      spawnWorktree(input, { loadTask: async () => null })
    ).rejects.toMatchObject({
      kind: "not_found",
      reason: "task_not_found",
    });
    await expect(
      spawnWorktree(input, {
        loadTask: async () => task(),
        findLiveForTask: async () => null,
        loadSandbox: async () => ({
          id: IDS.sandbox,
          repo_id: IDS.repo,
          status: "stopped",
        }),
      })
    ).rejects.toMatchObject({ reason: "sandbox_inactive" });
  });
});
