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
 * Every stub built by this module registers here so the registry (and its
 * drift-guard test) can tell a stub from a real implementation without
 * executing the tool. A `def.implemented: true` flag with no matching branch
 * in the registry silently degrades to a stub — exactly the failure mode the
 * guard exists to catch.
 */
const STUB_TOOLS = new WeakSet<Tool>();

export function isStubTool(candidate: Tool): boolean {
  return STUB_TOOLS.has(candidate);
}

/**
 * Create a basic stub tool with no parameters.
 */
export function createStubTool(def: OrchestratorToolDef): Tool {
  const stub = defineTool({
    description: def.description,
    parameters: z.object({}),
    execute: async () => ({
      status: "not_yet_implemented" as const,
      tool: def.name,
      note: `The ${def.name} tool is declared but not yet implemented. This capability is planned for the orchestrator.`,
    }),
  });
  STUB_TOOLS.add(stub);
  return stub;
}

/**
 * Create a not-yet-implemented stub with a proper schema.
 */
export function createTypedStub<T extends z.ZodType>(
  def: OrchestratorToolDef,
  schema: T
): Tool {
  const stub = defineTool({
    description: def.description,
    parameters: schema,
    execute: async () => ({
      status: "not_yet_implemented" as const,
      tool: def.name,
      note: `The ${def.name} tool is declared but not yet implemented. This capability is planned for the orchestrator.`,
    }),
  });
  STUB_TOOLS.add(stub);
  return stub;
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
