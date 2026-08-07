/**
 * Planning and delegation tools for the orchestrator.
 */
import { z } from "zod";
import type { OrchestratorToolDef } from "../types";

// --- Tool definitions ---

export const PLANNING_TOOLS: OrchestratorToolDef[] = [
  {
    name: "plan_mission",
    category: "planning",
    description: "Create a structured mission plan from a high-level objective",
    access: "mutation",
    implemented: false,
  },
  {
    name: "spawn_worktree",
    category: "planning",
    description:
      "Create an isolated Git worktree for a subagent with its own branch",
    access: "mutation",
    implemented: false,
  },
  {
    name: "spawn_subagent",
    category: "planning",
    description:
      "Launch a worker agent in an isolated worktree to execute a task",
    access: "mutation",
    implemented: false,
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

export const planMissionSchema = z.object({
  objective: z.string().describe("High-level objective for the mission"),
  constraints: z
    .array(z.string())
    .optional()
    .describe("Constraints or requirements for the plan"),
  context: z.string().optional().describe("Additional context for planning"),
});

export const spawnWorktreeSchema = z.object({
  branchName: z.string().describe("Name for the new branch"),
  baseBranch: z.string().optional().describe("Base branch to create from"),
  rootDirectory: z.string().optional().describe("Root directory within repo"),
});

export const spawnSubagentSchema = z.object({
  worktreeId: z.string().describe("ID of the worktree to use"),
  taskPrompt: z.string().describe("Task instructions for the subagent"),
  agentType: z
    .string()
    .optional()
    .describe("Type of agent to spawn (e.g., codex, claude-code)"),
});

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

// --- Schema map for stub tools ---

export const PLANNING_SCHEMAS: Record<string, z.ZodType> = {
  plan_mission: planMissionSchema,
  spawn_worktree: spawnWorktreeSchema,
  spawn_subagent: spawnSubagentSchema,
  steer_agent: steerAgentSchema,
  cancel_run: cancelRunSchema,
  retry_run: retryRunSchema,
  request_reasoning: requestReasoningSchema,
  score_implementations: scoreImplementationsSchema,
};
