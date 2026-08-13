/**
 * Helper utilities for orchestrator tool building.
 */
import { tool } from "ai";
import type { Tool } from "ai";
import type { OrchestratorToolContext, RepoToolDefaults } from "./types";

/**
 * Define a tool with loose typing to match existing patterns.
 */
export const defineTool = (def: Record<string, unknown>): Tool =>
  tool(def as Parameters<typeof tool>[0]);

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
