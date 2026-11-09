/**
 * Planning and delegation tools for the orchestrator.
 */
import { z } from "zod";
import type { OrchestratorToolDef } from "../types";
import {
  createListAgentsTool,
  createPlanMissionTool,
  createSpawnSubagentTool,
} from "./planning-impl";
import {
  createArchiveWorktreeTool,
  createListWorktreesTool,
  createPruneWorktreeTool,
  createSpawnWorktreeTool,
} from "./worktree-impl";

// --- Tool definitions ---

export const PLANNING_TOOLS: OrchestratorToolDef[] = [
  {
    name: "await_workers",
    category: "planning",
    description:
      "Resume the coordinator automatically after the mission's exact worker set finishes",
    access: "mutation",
    implemented: true,
    build: (ctx) => ctx.workerHandoffTool ?? null,
  },
  {
    name: "plan_mission",
    category: "planning",
    description: "Create a structured mission plan from a high-level objective",
    access: "mutation",
    implemented: true,
    build: (ctx) => createPlanMissionTool(ctx),
  },
  {
    name: "spawn_worktree",
    category: "planning",
    description:
      "Create an isolated Git worktree for a subagent with its own branch",
    access: "mutation",
    implemented: true,
    build: (ctx) =>
      ctx.sandboxSelectionRequired ? null : createSpawnWorktreeTool(ctx),
  },
  {
    name: "list_worktrees",
    category: "planning",
    description: "List persisted Git worktrees for the active mission",
    access: "read",
    implemented: true,
    build: (ctx) => createListWorktreesTool(ctx),
  },
  {
    name: "archive_worktree",
    category: "planning",
    description: "Archive a worktree while preserving its checkout and branch",
    access: "mutation",
    implemented: true,
    build: (ctx) => createArchiveWorktreeTool(ctx),
  },
  {
    name: "prune_worktree",
    category: "planning",
    description: "Remove an archived worktree checkout and retire its record",
    access: "approval",
    implemented: true,
    build: (ctx) => createPruneWorktreeTool(ctx),
  },
  {
    name: "list_agents",
    category: "planning",
    description:
      "List roster agents (own, team-shared, and presets) a worker can run as",
    access: "read",
    implemented: true,
    build: (ctx) => createListAgentsTool(ctx),
  },
  {
    name: "spawn_subagent",
    category: "planning",
    description:
      "Launch a worker agent in an isolated worktree to execute a task",
    access: "mutation",
    implemented: true,
    build: (ctx) => createSpawnSubagentTool(ctx),
  },
  {
    name: "steer_agent",
    category: "planning",
    description: "Send guidance or course correction to a running subagent",
    access: "mutation",
    implemented: false,
  },
  {
    name: "cancel_run",
    category: "planning",
    description: "Cancel a running agent or mission",
    access: "mutation",
    implemented: false,
  },
  {
    name: "retry_run",
    category: "planning",
    description: "Retry a failed agent run with optional parameter adjustments",
    access: "mutation",
    implemented: false,
  },
  {
    name: "request_reasoning",
    category: "planning",
    description:
      "Ask an agent to explain its reasoning or provide a progress report",
    access: "read",
    implemented: false,
  },
  {
    name: "score_implementations",
    category: "planning",
    description:
      "Compare and score multiple implementations from different worktrees",
    access: "read",
    implemented: false,
  },
];

// --- Schemas ---

export {
  listAgentsSchema,
  planMissionSchema,
  spawnSubagentSchema,
} from "./planning-impl";
export {
  archiveWorktreeSchema,
  listWorktreesSchema,
  pruneWorktreeSchema,
  spawnWorktreeSchema,
} from "./worktree-impl";

export const steerAgentSchema = z.object({
  agentId: z.string().describe("ID of the agent to steer"),
  guidance: z.string().describe("Guidance or course correction"),
});

export const cancelRunSchema = z.object({
  runId: z.string().describe("ID of the run to cancel"),
  reason: z.string().optional().describe("Reason for cancellation"),
});

export const retryRunSchema = z.object({
  runId: z.string().describe("ID of the run to retry"),
  adjustments: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Parameter adjustments for retry"),
});

export const requestReasoningSchema = z.object({
  agentId: z.string().describe("ID of the agent to query"),
  question: z.string().optional().describe("Specific question to answer"),
});

export const scoreImplementationsSchema = z.object({
  worktreeIds: z.array(z.string()).describe("IDs of worktrees to compare"),
  criteria: z.array(z.string()).optional().describe("Scoring criteria"),
});
