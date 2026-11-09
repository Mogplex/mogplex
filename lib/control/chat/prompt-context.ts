import type { InfrastructureDiagnosticScope } from "@/lib/agents/user-facing-output";
import type { OrchestratorPromptContext } from "@/lib/agents/orchestrator";
import type {
  resolveControlPromptSandboxContext,
  resolveControlPromptWorktrees,
} from "./context";
import type { ControlKnowledgeContext } from "./knowledge-context";
import type { ControlChatRequestBody } from "./types";

type PromptSandboxContext = Awaited<
  ReturnType<typeof resolveControlPromptSandboxContext>
>;
type PromptWorktreeContext = Awaited<
  ReturnType<typeof resolveControlPromptWorktrees>
>;

/**
 * Assemble the orchestrator system-prompt context from the validated request
 * and the server-resolved sandbox, worktree, memory, and skill state.
 */
export function buildControlPromptContext(input: {
  body: ControlChatRequestBody;
  missionId: string | null | undefined;
  infrastructureDiagnosticScope: InfrastructureDiagnosticScope;
  sandboxContext: PromptSandboxContext;
  worktreeContext: PromptWorktreeContext;
  knowledge: ControlKnowledgeContext;
}): OrchestratorPromptContext {
  const { body } = input;
  return {
    repoFullName: body.repoFullName ?? undefined,
    repoOwner: body.repoOwner ?? undefined,
    repoName: body.repoName ?? undefined,
    repoBranch: body.repoBranch ?? undefined,
    repoBaseBranch: body.repoBaseBranch ?? undefined,
    missionId: input.missionId ?? undefined,
    missionTitle: body.missionTitle ?? undefined,
    controlScope: body.scope ?? undefined,
    controlTarget: body.target ?? undefined,
    controlPermissions: body.permissions ?? undefined,
    controlMode: body.mode ?? undefined,
    infrastructureDiagnosticScope: input.infrastructureDiagnosticScope,
    sandboxSelectionRequired: input.sandboxContext.selectionRequired,
    activeSandboxes: input.sandboxContext.sandboxes,
    activeWorktrees: input.worktreeContext.worktrees,
    memoryContext: input.knowledge.memoryContext,
    skills: input.knowledge.skills,
  };
}
