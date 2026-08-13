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
    implemented: true,
  },
  {
    name: "spawn_worktree",
    category: "planning",
    description:
      "Create an isolated Git worktree for a subagent with its own branch",
    access: "mutation",
    implemented: true,
  },
  {
    name: "list_worktrees",
    category: "planning",
    description: "List persisted Git worktrees for the active mission",
    access: "read",
    implemented: true,
  },
  {
    name: "archive_worktree",
    category: "planning",
    description: "Archive a worktree while preserving its checkout and branch",
    access: "mutation",
    implemented: true,
  },
  {
    name: "prune_worktree",
    category: "planning",
    description: "Remove an archived worktree checkout and retire its record",
    access: "approval",
    implemented: true,
  },
  {
    name: "spawn_subagent",
    category: "planning",
    description:
      "Launch a worker agent in an isolated worktree to execute a task",
    access: "mutation",
    implemented: true,
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
  objective: z.string().min(1).describe("High-level objective for the mission"),
  constraints: z
    .array(z.string())
    .optional()
    .describe("Constraints or requirements for the plan"),
  context: z.string().optional().describe("Additional context for planning"),
  tasks: z
    .array(
      z.object({
        slug: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .refine((slug) => slug !== "master", {
            message: '"master" is reserved for the mission spec',
          })
          .describe("Stable lowercase task slug"),
        title: z.string().min(1).max(500),
        prompt: z.string().min(1),
        harness: z.enum(["codex", "claude-code"]).default("codex"),
        ownedPaths: z.array(z.string()).min(1),
        blockedPaths: z.array(z.string()).optional(),
        dependsOn: z.array(z.string()).optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
        validationCommands: z.array(z.string()).optional(),
      })
    )
    .min(1)
    .describe("Concrete tasks that can each receive a worktree"),
});

export const spawnWorktreeSchema = z.object({
  taskId: z
    .string()
    .uuid()
    .describe("Orchestration task assigned to the checkout"),
  sandboxId: z
    .string()
    .uuid()
    .optional()
    .describe("Sandbox record that will host the checkout"),
});

export const listWorktreesSchema = z.object({
  includePruned: z.boolean().optional().describe("Include retired records"),
});

export const archiveWorktreeSchema = z.object({
  worktreeId: z.string().uuid().describe("Worktree to archive"),
});

export const pruneWorktreeSchema = z.object({
  worktreeId: z.string().uuid().describe("Archived worktree to remove"),
  force: z.boolean().optional().describe("Remove a dirty checkout"),
});

export const spawnSubagentSchema = z.object({
  worktreeId: z.string().uuid().describe("Persisted worktree to use"),
  taskPrompt: z.string().min(1).describe("Task instructions for the subagent"),
  agentType: z.enum(["codex", "claude-code"]).default("codex"),
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
  list_worktrees: listWorktreesSchema,
  archive_worktree: archiveWorktreeSchema,
  prune_worktree: pruneWorktreeSchema,
  spawn_subagent: spawnSubagentSchema,
  steer_agent: steerAgentSchema,
  cancel_run: cancelRunSchema,
  retry_run: retryRunSchema,
  request_reasoning: requestReasoningSchema,
  score_implementations: scoreImplementationsSchema,
};
