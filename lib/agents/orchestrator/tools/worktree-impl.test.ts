import { describe, expect, it, vi } from "vitest";
import type { OrchestrationWorktreeDTO } from "@/lib/worktrees/types";
import {
  createSpawnWorktreeToolWithDeps,
  createListWorktreesTool,
} from "./worktree-impl";
import type { OrchestratorToolContext } from "../types";

const worktree = {
  id: "worktree-1",
  sandbox_id: "sandbox-new",
} as OrchestrationWorktreeDTO;

describe("spawn_worktree sandbox binding", () => {
  it("waits on a pending binding and then uses the sandbox that became ready", async () => {
    const binding = {
      sandboxId: "sandbox-new",
      status: "pending" as "pending" | "running" | "unavailable",
    };
    const spawn = vi.fn(async () => worktree);
    const ctx: OrchestratorToolContext = {
      userId: "user-1",
      repoId: "repo-1",
      orchestrationRunId: "run-1",
      sandboxId: "sandbox-old",
      sandboxBinding: binding,
    };
    const tool = createSpawnWorktreeToolWithDeps(ctx, {
      spawnWorktree: spawn,
    }) as unknown as {
      execute: (input: { taskId: string }) => Promise<unknown>;
    };

    await expect(tool.execute({ taskId: "task-1" })).resolves.toEqual({
      status: "waiting",
      message: "Sandbox startup is still in progress.",
      reason: "sandbox_pending",
    });
    expect(spawn).not.toHaveBeenCalled();

    binding.status = "running";
    await expect(tool.execute({ taskId: "task-1" })).resolves.toEqual({
      status: "ok",
      worktree,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith({
      userId: "user-1",
      runId: "run-1",
      taskId: "task-1",
      sandboxId: "sandbox-new",
    });
  });
});

describe("worktree worker status", () => {
  const context: OrchestratorToolContext = {
    userId: "owner",
    repoId: "repo",
    missionId: "session",
    orchestrationRunId: "run",
  };
  const execute = (ctx = context, failedRead = false) => {
    const tool = createListWorktreesTool(ctx, {
      listWorktrees: async () => [{ ...worktree, status: "active" }],
      loadWorkers: async (userId, sessionId) => {
        if (failedRead) throw new Error("Worker status unavailable");
        if (userId !== "owner" || sessionId !== "session") return null;
        return [
          {
            id: "worker",
            worktreeId: worktree.id,
            branch: "fix/tests",
            status: "failed",
            error: "Worker could not authenticate.",
            updatedAt: "2026-09-05",
            events: [],
          },
        ];
      },
    }) as unknown as {
      execute: (input: { includePruned: boolean }) => Promise<unknown>;
    };
    return tool.execute({ includePruned: false });
  };
  it("does not tell the coordinator an active checkout means a running worker", async () => {
    expect(await execute()).toMatchObject({
      status: "ok",
      worktrees: [
        {
          status: "active",
          worker: {
            id: "worker",
            status: "failed",
            error: "Worker could not authenticate.",
          },
        },
      ],
    });
  });
  it("reports absent mission scope and status read failure explicitly", async () => {
    expect(await execute({ userId: "owner" })).toMatchObject({
      status: "error",
      reason: "mission_not_linked",
    });
    expect(await execute(context, true)).toMatchObject({
      status: "error",
      error: "Worker status unavailable",
    });
  });
});
