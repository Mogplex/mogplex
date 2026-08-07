/**
 * Helper utilities for orchestrator tool building.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type {
  OrchestratorToolDef,
  OrchestratorToolContext,
  RepoToolDefaults,
} from "./types";

/**
 * Define a tool with loose typing to match existing patterns.
 */
export const defineTool = (def: Record<string, unknown>): Tool =>
  tool(def as Parameters<typeof tool>[0]);

/**
 * Create a basic stub tool with no parameters.
 */
export function createStubTool(def: OrchestratorToolDef): Tool {
  return defineTool({
    description: def.description,
    parameters: z.object({}),
    execute: async () => ({
      status: "not_yet_implemented" as const,
      tool: def.name,
      note: `The ${def.name} tool is declared but not yet implemented. This capability is planned for the orchestrator.`,
    }),
  });
}

/**
 * Create a not-yet-implemented stub with a proper schema.
 */
export function createTypedStub<T extends z.ZodType>(
  def: OrchestratorToolDef,
  schema: T
): Tool {
  return defineTool({
    description: def.description,
    parameters: schema,
    execute: async () => ({
      status: "not_yet_implemented" as const,
      tool: def.name,
      note: `The ${def.name} tool is declared but not yet implemented. This capability is planned for the orchestrator.`,
    }),
  });
}

/**
 * Build repo defaults from the orchestrator context.
 */
export function buildRepoDefaults(
  ctx: OrchestratorToolContext
): RepoToolDefaults {
  return {
    owner: ctx.repoOwner ?? undefined,
    repo: ctx.repoName ?? undefined,
    branch: ctx.repoBranch ?? undefined,
    baseBranch: ctx.repoBaseBranch ?? undefined,
  };
}
