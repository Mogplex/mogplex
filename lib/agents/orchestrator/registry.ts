import type { Tool } from "ai";
import type {
  OrchestratorToolDef,
  OrchestratorToolContext,
  OrchestratorToolCategory,
} from "./types";
import { buildRepoDefaults } from "./helpers";
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

export type {
  OrchestratorToolAccess,
  OrchestratorToolCategory,
  OrchestratorToolDef,
  OrchestratorToolContext,
} from "./types";

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

export function getToolDef(name: string): OrchestratorToolDef | undefined {
  return ORCHESTRATOR_TOOLS.find((tool) => tool.name === name);
}

export function getToolsByCategory(
  category: OrchestratorToolCategory
): OrchestratorToolDef[] {
  return ORCHESTRATOR_TOOLS.filter((tool) => tool.category === category);
}

export function getImplementationStats(): {
  implemented: number;
  planned: number;
  total: number;
} {
  const implemented = ORCHESTRATOR_TOOLS.filter(
    (tool) => tool.implemented
  ).length;
  const total = ORCHESTRATOR_TOOLS.length;
  return { implemented, planned: total - implemented, total };
}

function normalizeToolContext(
  ctx: OrchestratorToolContext
): OrchestratorToolContext {
  if (ctx.sandboxBinding) return ctx;
  ctx.sandboxBinding = {
    sandboxId: ctx.sandboxId ?? null,
    status: ctx.sandboxId ? "running" : "unavailable",
  };
  return ctx;
}

export function buildOrchestratorTools(
  ctx: OrchestratorToolContext
): Record<string, Tool> {
  const toolContext = normalizeToolContext(ctx);
  const repoDefaults = buildRepoDefaults(toolContext);
  const tools: Record<string, Tool> = {};

  for (const def of ORCHESTRATOR_TOOLS) {
    if (!def.implemented) continue;
    const built = def.build(toolContext, repoDefaults);
    if (built) tools[def.name] = built;
  }

  return tools;
}
