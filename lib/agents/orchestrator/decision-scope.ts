import type { DecisionScope } from "@/lib/decisions/types";
import type { OrchestratorToolContext } from "./types";

/** Attribution for decisions made on behalf of a Control tool context. */
export function controlDecisionScope(
  ctx: OrchestratorToolContext
): DecisionScope {
  return {
    surface: "control",
    userId: ctx.userId,
    teamId: ctx.teamId ?? null,
    repoId: ctx.repoId ?? null,
    aiCallId: ctx.aiCallId ?? null,
    conversationId: ctx.conversationId ?? null,
  };
}
