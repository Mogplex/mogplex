import { describe, expect, it, vi } from "vitest";
import type { OrchestrationWorktreeDTO } from "@/lib/worktrees/types";
import { createSpawnWorktreeToolWithDeps } from "./worktree-impl";
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
