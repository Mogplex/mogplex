import { z } from "zod";
import type { Tool } from "ai";
import {
  archiveWorktree,
  diffWorktree,
  listWorktrees,
  pruneWorktree,
  rebaseWorktree,
  spawnWorktree,
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
  };
}

export function createSpawnWorktreeTool(ctx: OrchestratorToolContext): Tool {
  return defineTool({
    description:
      "Create or reuse the real Git worktree assigned to an orchestration task inside a selected sandbox.",
    inputSchema: spawnWorktreeSchema,
    execute: async ({
      taskId,
      sandboxId,
    }: z.infer<typeof spawnWorktreeSchema>) => {
      if (!ctx.orchestrationRunId) return missingRun();
      const resolvedSandboxId = sandboxId ?? ctx.sandboxId;
      if (!resolvedSandboxId) {
        return { status: "error" as const, error: "Select a sandbox first." };
      }
      try {
        const worktree = await spawnWorktree({
          userId: ctx.userId,
          runId: ctx.orchestrationRunId,
          taskId,
          sandboxId: resolvedSandboxId,
        });
        return { status: "ok" as const, worktree };
      } catch (error) {
        return toolError(error);
      }
    },
  });
}

export function createListWorktreesTool(ctx: OrchestratorToolContext): Tool {
  return defineTool({
    description:
      "List real Git worktrees for the active mission. Sandbox records are not included.",
    inputSchema: listWorktreesSchema,
    execute: async ({ includePruned }: z.infer<typeof listWorktreesSchema>) => {
      if (!ctx.orchestrationRunId) return missingRun();
      try {
        const worktrees = await listWorktrees({
          userId: ctx.userId,
          runId: ctx.orchestrationRunId,
          repoId: ctx.repoId,
          includePruned,
        });
        return { status: "ok" as const, worktrees };
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
