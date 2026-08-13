import { createHash } from "node:crypto";
import { z } from "zod";
import type { Tool } from "ai";
import { createOrchestrationPlan } from "@/lib/orchestrations/plan-store";
import { getOrchestrationRunDetails } from "@/lib/orchestrations/store";
import { buildTaskBranch } from "@/lib/orchestrations/branches";
import {
  buildTaskSpecPath,
  findOwnedPathOverlaps,
} from "@/lib/orchestrations/validation";
import { startMogplexApiRun } from "@/lib/mogplex-api/runs";
import { bindWorktreeAgent, loadOwnedWorktree } from "@/lib/worktrees/store";
import { defineTool } from "../helpers";
import type { OrchestratorToolContext } from "../types";
import { planMissionSchema, spawnSubagentSchema } from "./planning";

type PlanMissionDeps = {
  getRunDetails: typeof getOrchestrationRunDetails;
  createPlan: typeof createOrchestrationPlan;
};

const defaultPlanMissionDeps: PlanMissionDeps = {
  getRunDetails: getOrchestrationRunDetails,
  createPlan: createOrchestrationPlan,
};

function missingRun() {
  return {
    status: "error" as const,
    error: "This Control session is not linked to an orchestration run.",
  };
}

export function createPlanMissionTool(
  ctx: OrchestratorToolContext,
  overrides: Partial<PlanMissionDeps> = {}
): Tool {
  const deps = { ...defaultPlanMissionDeps, ...overrides };
  return defineTool({
    description:
      "Persist the mission plan as orchestration specs and runnable tasks. Each returned task ID can be assigned its own worktree.",
    inputSchema: planMissionSchema,
    execute: async (input: z.infer<typeof planMissionSchema>) => {
      if (!ctx.orchestrationRunId) return missingRun();
      try {
        const details = await deps.getRunDetails({
          runId: ctx.orchestrationRunId,
          userId: ctx.userId,
        });
        if (!details || details.run.repo_id !== ctx.repoId) {
          return { status: "error" as const, error: "Mission not found." };
        }
        if (details.tasks.length > 0) {
          return {
            status: "ok" as const,
            reused: true,
            tasks: details.tasks,
          };
        }

        const taskSlugs = new Set(input.tasks.map((task) => task.slug));
        if (taskSlugs.size !== input.tasks.length) {
          return {
            status: "error" as const,
            error: "Task slugs must be unique.",
          };
        }
        for (const task of input.tasks) {
          for (const dependency of task.dependsOn ?? []) {
            if (!taskSlugs.has(dependency)) {
              return {
                status: "error" as const,
                error: `Task ${task.slug} depends on unknown task ${dependency}.`,
              };
            }
          }
        }
        const overlaps = findOwnedPathOverlaps(
          input.tasks.map((task) => ({
            slug: task.slug,
            ownedPaths: task.ownedPaths,
            dependsOn: task.dependsOn,
          }))
        );
        if (overlaps.length > 0) {
          const overlap = overlaps[0];
          return {
            status: "error" as const,
            error: `Tasks ${overlap.leftSlug} and ${overlap.rightSlug} overlap at ${overlap.leftPath} and ${overlap.rightPath}. Add a dependency or split ownership.`,
          };
        }

        const tasks = await deps.createPlan({
          runId: details.run.id,
          userId: ctx.userId,
          objective: input.objective,
          context: input.context,
          constraints: input.constraints,
          tasks: input.tasks.map((taskInput, index) => ({
            orderIndex: index,
            slug: taskInput.slug,
            title: taskInput.title,
            filePath: buildTaskSpecPath(
              details.run.slug,
              index,
              taskInput.slug
            ),
            branchName: buildTaskBranch(details.run.slug, taskInput.slug),
            ownedPaths: taskInput.ownedPaths,
            blockedPaths: taskInput.blockedPaths ?? [],
            dependsOn: taskInput.dependsOn ?? [],
            acceptanceCriteria: taskInput.acceptanceCriteria ?? [],
            validationCommands: taskInput.validationCommands ?? [],
            prompt: taskInput.prompt,
            harness: taskInput.harness,
          })),
        });
        return { status: "ok" as const, reused: false, tasks };
      } catch (error) {
        return {
          status: "error" as const,
          error:
            error instanceof Error ? error.message : "Mission planning failed",
        };
      }
    },
  });
}

type SpawnSubagentDeps = {
  loadWorktree: typeof loadOwnedWorktree;
  startRun: typeof startMogplexApiRun;
  bindAgent: typeof bindWorktreeAgent;
};

const defaultSpawnSubagentDeps: SpawnSubagentDeps = {
  loadWorktree: loadOwnedWorktree,
  startRun: startMogplexApiRun,
  bindAgent: bindWorktreeAgent,
};

export function createSpawnSubagentTool(
  ctx: OrchestratorToolContext,
  overrides: Partial<SpawnSubagentDeps> = {}
): Tool {
  const deps = { ...defaultSpawnSubagentDeps, ...overrides };
  return defineTool({
    description:
      "Launch a worker bound to one active persisted worktree. The worker uses that exact checkout path and does not create a sandbox or branch.",
    inputSchema: spawnSubagentSchema,
    execute: async ({
      worktreeId,
      taskPrompt,
      agentType,
    }: z.infer<typeof spawnSubagentSchema>) => {
      if (!ctx.orchestrationRunId || !ctx.repoId) return missingRun();
      try {
        const worktree = await deps.loadWorktree({
          worktreeId,
          userId: ctx.userId,
        });
        if (
          worktree?.run_id !== ctx.orchestrationRunId ||
          worktree?.repo_id !== ctx.repoId ||
          worktree?.status !== "active"
        ) {
          return {
            status: "error" as const,
            error: "Active mission worktree not found.",
          };
        }
        const promptHash = createHash("sha256")
          .update(taskPrompt)
          .digest("hex")
          .slice(0, 16);
        const result = await deps.startRun({
          user: {
            userId: ctx.userId,
            keyId: `control:${ctx.aiCallId ?? ctx.conversationId ?? "session"}`,
            scopes: ["runs:write"],
          },
          idempotencyKey: `control:${ctx.aiCallId ?? "run"}:${worktree.id}:${promptHash}`,
          body: {
            repoId: ctx.repoId,
            prompt: taskPrompt,
            harness: agentType,
            worktreeId: worktree.id,
            conversationId: ctx.conversationId,
            workspaceSessionId: ctx.workspaceSessionId,
            mode: ctx.controlMode,
          },
          extraMetadata: {
            orchestrationRunId: ctx.orchestrationRunId,
            orchestrationTaskId: worktree.task_id,
            orchestrationWorktreeId: worktree.id,
          },
        });
        const boundWorktree = await deps.bindAgent({
          worktreeId: worktree.id,
          userId: ctx.userId,
          agentId: result.run.aiCallId,
        });
        return {
          status: "ok" as const,
          replayed: result.replayed,
          run: result.run,
          worktree: boundWorktree,
        };
      } catch (error) {
        return {
          status: "error" as const,
          error:
            error instanceof Error ? error.message : "Subagent launch failed",
        };
      }
    },
  });
}
