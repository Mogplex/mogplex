/**
 * Orchestrator tool registry - assembles tools from category modules.
 *
 * This module composes the orchestrator's tool surface from category-specific
 * modules and provides factory functions for building tool instances.
 */
import type { Tool } from "ai";
import {
  createReadFile,
  createListFiles,
  createWriteFile,
  createStartSandbox,
  createStopSandbox,
  createGithubPullRequestTool,
  createGithubApi,
  webFetch,
  createTerminalExec,
  createMemoryTools,
} from "@/lib/agents/tools";
import type {
  OrchestratorToolDef,
  OrchestratorToolContext,
  OrchestratorToolCategory,
  RepoToolDefaults,
} from "./types";
import { buildRepoDefaults } from "./helpers";
import {
  createHandoffNoteTool,
  createSummarizeHistoryTool,
} from "./tools/memory-impl";
import { createRequestApprovalTool } from "./tools/governance-impl";
import {
  createPlanMissionTool,
  createSpawnSubagentTool,
} from "./tools/planning-impl";
import {
  createArchiveWorktreeTool,
  createDiffWorktreeTool,
  createListWorktreesTool,
  createPruneWorktreeTool,
  createRebaseWorktreeTool,
  createSpawnWorktreeTool,
} from "./tools/worktree-impl";
import { PLANNING_TOOLS } from "./tools/planning";
import { FILESYSTEM_TOOLS } from "./tools/filesystem";
import { GIT_TOOLS } from "./tools/git";
import { EXECUTION_TOOLS } from "./tools/execution";
import { MCP_TOOLS } from "./tools/mcp";
import { INFRASTRUCTURE_TOOLS } from "./tools/infrastructure";
import { DELIVERY_TOOLS } from "./tools/delivery";
import { GOVERNANCE_TOOLS } from "./tools/governance";
import {
  MEMORY_TOOLS,
  COMMUNICATION_TOOLS,
} from "./tools/memory-communication";

// Re-export types from types module
export type {
  OrchestratorToolAccess,
  OrchestratorToolCategory,
  OrchestratorToolDef,
  OrchestratorToolContext,
} from "./types";

/**
 * Complete registry of orchestrator tools by category.
 */
export const ORCHESTRATOR_TOOLS: OrchestratorToolDef[] = [
  ...PLANNING_TOOLS,
  ...FILESYSTEM_TOOLS,
  ...GIT_TOOLS,
  ...EXECUTION_TOOLS,
  ...MCP_TOOLS,
  ...INFRASTRUCTURE_TOOLS,
  ...DELIVERY_TOOLS,
  ...GOVERNANCE_TOOLS,
  ...MEMORY_TOOLS,
  ...COMMUNICATION_TOOLS,
];

/**
 * Get a tool definition by name.
 */
export function getToolDef(name: string): OrchestratorToolDef | undefined {
  return ORCHESTRATOR_TOOLS.find((t) => t.name === name);
}

/**
 * Get all tools in a category.
 */
export function getToolsByCategory(
  category: OrchestratorToolCategory
): OrchestratorToolDef[] {
  return ORCHESTRATOR_TOOLS.filter((t) => t.category === category);
}

/**
 * Get counts of implemented vs planned tools for diagnostics.
 */
export function getImplementationStats(): {
  implemented: number;
  planned: number;
  total: number;
} {
  const implemented = ORCHESTRATOR_TOOLS.filter((t) => t.implemented).length;
  const total = ORCHESTRATOR_TOOLS.length;
  return { implemented, planned: total - implemented, total };
}

/**
 * Build a tool for the given definition using the context.
 * Planned definitions and implemented tools unavailable in this context are
 * omitted so the model never receives a callable placeholder.
 */
function buildToolForDef(
  def: OrchestratorToolDef,
  ctx: OrchestratorToolContext,
  repoDefaults: RepoToolDefaults
): Tool | null {
  if (!def.implemented) return null;

  if (def.name === "read_file") {
    return createReadFile(ctx.githubToken, repoDefaults);
  }
  if (def.name === "list_files") {
    return createListFiles(ctx.githubToken, repoDefaults);
  }
  if (def.name === "write_file") {
    return ctx.sandboxId ? createWriteFile(ctx.userId, ctx.sandboxId) : null;
  }
  if (def.name === "search_repo") {
    return ctx.githubToken
      ? createGithubApi(ctx.githubToken, repoDefaults)
      : null;
  }
  if (def.name === "run_command") {
    if (ctx.sandboxSelectionRequired) return null;
    return createTerminalExec(
      ctx.sandboxId ?? undefined,
      ctx.userId,
      ctx.repoId ?? undefined
    );
  }
  if (def.name === "sandbox_start") {
    if (ctx.sandboxSelectionRequired) return null;
    return createStartSandbox(ctx.userId);
  }
  if (def.name === "sandbox_stop") {
    return ctx.sandboxId && !ctx.sandboxSelectionRequired
      ? createStopSandbox(ctx.userId, ctx.sandboxId)
      : null;
  }
  if (def.name === "open_pr") {
    return ctx.githubToken
      ? createGithubPullRequestTool(ctx.githubToken, repoDefaults)
      : null;
  }
  if (def.name === "web_fetch") {
    return webFetch;
  }
  if (def.name === "memory_write" || def.name === "memory_search") {
    const memoryTools = createMemoryTools(ctx.userId, ctx.repoId ?? undefined, {
      workspaceSessionId: ctx.workspaceSessionId ?? null,
      conversationId: ctx.conversationId ?? null,
      sandboxId: ctx.sandboxId ?? null,
    });
    return def.name === "memory_write"
      ? memoryTools.add_memory
      : memoryTools.search_memories;
  }
  if (def.name === "summarize_history") {
    return createSummarizeHistoryTool(ctx);
  }
  if (def.name === "handoff_note") {
    return createHandoffNoteTool(ctx);
  }
  if (def.name === "request_approval") {
    return createRequestApprovalTool(ctx);
  }
  if (def.name === "plan_mission") {
    return createPlanMissionTool(ctx);
  }
  if (def.name === "spawn_worktree") {
    return createSpawnWorktreeTool(ctx);
  }
  if (def.name === "list_worktrees") {
    return createListWorktreesTool(ctx);
  }
  if (def.name === "archive_worktree") {
    return createArchiveWorktreeTool(ctx);
  }
  if (def.name === "prune_worktree") {
    return createPruneWorktreeTool(ctx);
  }
  if (def.name === "rebase_worktree") {
    return createRebaseWorktreeTool(ctx);
  }
  if (def.name === "diff_worktree") {
    return createDiffWorktreeTool(ctx);
  }
  if (def.name === "spawn_subagent") {
    return createSpawnSubagentTool(ctx);
  }

  return null;
}

/**
 * Build callable orchestrator tools for the current context. Planned tools and
 * implemented tools missing required context are intentionally absent.
 */
export function buildOrchestratorTools(
  ctx: OrchestratorToolContext
): Record<string, Tool> {
  const repoDefaults = buildRepoDefaults(ctx);
  const tools: Record<string, Tool> = {};

  for (const def of ORCHESTRATOR_TOOLS) {
    const built = buildToolForDef(def, ctx, repoDefaults);
    if (built) tools[def.name] = built;
  }

  return tools;
}
