import type { AgentRuntime } from "@/lib/agents/runtime/types";
import type { CatalogSkill } from "@/lib/skill-catalog/types";
import type { SandboxSetupContext } from "./setup";
import type { SandboxHarnessPostDeps } from "./types";

export type HarnessSkillCatalog = {
  /** Catalog skills offered to the harness, beyond what the agent carries. */
  skills: CatalogSkill[];
  invokedIds: string[];
};

/**
 * Records which of the skills in play the task needed: the roster agent's
 * attached skills and the user's catalog, in one check. It runs beside the
 * harness, never in front of it. The promise is handed to `runAfterResponse`
 * so the run starts on time and the function stays alive until the record is
 * written.
 */
export function observeHarnessSkills(
  deps: Pick<
    SandboxHarnessPostDeps,
    "observeSkillSelection" | "runAfterResponse"
  >,
  ctx: SandboxSetupContext,
  input: {
    agentRuntime: AgentRuntime | null;
    catalog: HarnessSkillCatalog | null;
    /** The task as the user wrote it, before any block was prepended. */
    request: string;
  }
): void {
  if (!input.agentRuntime && !input.catalog) return;
  const observed = deps.observeSkillSelection({
    agent: input.agentRuntime,
    catalog: input.catalog,
    request: input.request,
    delivery: "files",
    scope: {
      surface: "harness",
      userId: ctx.userId,
      teamId: ctx.teamId,
      repoId: ctx.repoId,
      aiCallId: ctx.aiCallId,
      conversationId: ctx.conversationId,
    },
  });
  try {
    deps.runAfterResponse(() => observed);
  } catch {
    // Outside a request scope the check still runs; it just is not held open.
  }
}
