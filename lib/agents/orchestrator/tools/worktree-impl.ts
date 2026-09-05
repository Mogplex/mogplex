import { z } from "zod";
import { loadControlWorkers } from "@/lib/control/workers-data";
import type { Tool } from "ai";
import {
  archiveWorktree,
  diffWorktree,
  listWorktrees,
  pruneWorktree,
  rebaseWorktree,
  spawnWorktree,
  WorktreeServiceError,
} from "@/lib/worktrees/service";
import { defineTool } from "../helpers";
import type { OrchestratorToolContext } from "../types";
import {
  archiveWorktreeSchema,
  listWorktreesSchema,
  pruneWorktreeSchema,
  spawnWorktreeSchema,
} from "./planning";
import { diffWorktreeSchema, rebaseWorktreeSchema } from "./git";

function missingRun() {
  return {
    status: "error" as const,
    error: "This Control session is not linked to an orchestration run.",
    reason: "mission_not_linked" as const,
  };
}

function missionScope(ctx: OrchestratorToolContext) {
  if (!ctx.orchestrationRunId || !ctx.repoId) return null;
  return { runId: ctx.orchestrationRunId, repoId: ctx.repoId };
}

function toolError(error: unknown) {
  return {
    status: "error" as const,
    error: error instanceof Error ? error.message : "Worktree operation failed",
    reason:
      error instanceof WorktreeServiceError
        ? error.reason
        : ("operation_failed" as const),
  };
}

export function createSpawnWorktreeTool(ctx: OrchestratorToolContext): Tool {
  return createSpawnWorktreeToolWithDeps(ctx, { spawnWorktree });
}

type SpawnWorktreeDeps = {
  spawnWorktree: typeof spawnWorktree;
};

export function createSpawnWorktreeToolWithDeps(
  ctx: OrchestratorToolContext,
  deps: SpawnWorktreeDeps
): Tool {
  return defineTool({
    description:
      "Create or reuse the real Git worktree for a planned task in the active mission inside the selected sandbox. This creates an isolated checkout and branch; it does not start, stop, or otherwise change sandbox compute.",
    inputSchema: spawnWorktreeSchema,
    execute: async ({ taskId }: z.infer<typeof spawnWorktreeSchema>) => {
      if (!ctx.orchestrationRunId) return missingRun();
      const sandboxId = ctx.sandboxBinding?.sandboxId ?? null;
      // Production launch waits for readiness; this also guards injected or
      // future resolvers that may expose the intermediate binding state.
      if (ctx.sandboxBinding?.status === "pending") {
        return {
          status: "waiting" as const,
          message: "Sandbox startup is still in progress.",
          reason: "sandbox_pending" as const,
        };
      }
      if (!sandboxId || ctx.sandboxBinding?.status === "unavailable") {
        return {
          status: "error" as const,
          error: "Select a sandbox first.",
          reason: "sandbox_not_selected" as const,
        };
      }
      try {
        const worktree = await deps.spawnWorktree({
          userId: ctx.userId,
          runId: ctx.orchestrationRunId,
          taskId,
          sandboxId,
        });
        return { status: "ok" as const, worktree };
      } catch (error) {
        return toolError(error);
      }
    },
  });
}

export function createListWorktreesTool(
  ctx: OrchestratorToolContext,
  overrides: Partial<{
    listWorktrees: typeof listWorktrees;
    loadWorkers: typeof loadControlWorkers;
  }> = {}
): Tool {
  const deps = { listWorktrees, loadWorkers: loadControlWorkers, ...overrides };
  return defineTool({
    description:
      "List real Git worktrees and the latest worker status for the active mission. Worktree status active means the checkout exists, not that its worker is running. Inspect failed worker output before retrying. Sandbox records are not included.",
    inputSchema: listWorktreesSchema,
    execute: async ({ includePruned }: z.infer<typeof listWorktreesSchema>) => {
      if (!ctx.orchestrationRunId) return missingRun();
      try {
        const worktrees = await deps.listWorktrees({
          userId: ctx.userId,
          runId: ctx.orchestrationRunId,
          repoId: ctx.repoId,
          includePruned,
        });
        const workers = ctx.missionId
          ? await deps.loadWorkers(ctx.userId, ctx.missionId)
          : null;
        return {
          status: "ok" as const,
          worktrees: worktrees.map((worktree) => {
            const worker = workers?.find(
              (candidate) => candidate.worktreeId === worktree.id
            );
            return {
              ...worktree,
              worker: worker
                ? {
                    id: worker.id,
                    status: worker.status,
                    error: worker.error,
                    updatedAt: worker.updatedAt,
                  }
                : null,
            };
          }),
        };
      } catch (error) {
        return toolError(error);
      }
    },
  });
}

export function createArchiveWorktreeTool(ctx: OrchestratorToolContext): Tool {
  return defineTool({
    description:
      "Archive a worktree record without stopping its sandbox or deleting its checkout.",
    inputSchema: archiveWorktreeSchema,
    execute: async ({ worktreeId }: z.infer<typeof archiveWorktreeSchema>) => {
      const scope = missionScope(ctx);
      if (!scope) return missingRun();
      try {
        const worktree = await archiveWorktree({
          userId: ctx.userId,
          worktreeId,
          ...scope,
        });
        return { status: "ok" as const, worktree };
      } catch (error) {
        return toolError(error);
      }
    },
  });
}

export function createPruneWorktreeTool(ctx: OrchestratorToolContext): Tool {
  return defineTool({
    description:
      "Remove an archived managed checkout. This does not stop or delete the sandbox.",
    inputSchema: pruneWorktreeSchema,
    execute: async ({
      worktreeId,
      force,
    }: z.infer<typeof pruneWorktreeSchema>) => {
      const scope = missionScope(ctx);
      if (!scope) return missingRun();
      try {
        const worktree = await pruneWorktree({
          userId: ctx.userId,
          worktreeId,
          force,
          ...scope,
        });
        return { status: "ok" as const, worktree };
      } catch (error) {
        return toolError(error);
      }
    },
  });
}

export function createRebaseWorktreeTool(ctx: OrchestratorToolContext): Tool {
  return defineTool({
    description:
      "Rebase the worktree's persisted branch onto its persisted base branch.",
    inputSchema: rebaseWorktreeSchema,
    execute: async ({ worktreeId }: z.infer<typeof rebaseWorktreeSchema>) => {
      const scope = missionScope(ctx);
      if (!scope) return missingRun();
      try {
        const worktree = await rebaseWorktree({
          userId: ctx.userId,
          worktreeId,
          ...scope,
        });
        return { status: "ok" as const, worktree };
      } catch (error) {
        return toolError(error);
      }
    },
  });
}

export function createDiffWorktreeTool(ctx: OrchestratorToolContext): Tool {
  return defineTool({
    description:
      "Read the diff for one persisted worktree from its persisted base branch.",
    inputSchema: diffWorktreeSchema,
    execute: async ({ worktreeId }: z.infer<typeof diffWorktreeSchema>) => {
      const scope = missionScope(ctx);
      if (!scope) return missingRun();
      try {
        const result = await diffWorktree({
          userId: ctx.userId,
          worktreeId,
          ...scope,
        });
        return { status: "ok" as const, ...result };
      } catch (error) {
        return toolError(error);
      }
    },
  });
}
