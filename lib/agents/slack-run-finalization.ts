import {
  createSandboxTaskLifecycle,
  type SandboxTaskLifecycleDeps,
} from "@/lib/agents/orchestrator/sandbox-task-lifecycle";
import { sanitizeAgentUserFacingText } from "@/lib/agents/user-facing-output";

export function createSlackRunFinalization(input: {
  userId: string;
  userText: string;
  repoName?: string | null;
  sandboxId?: string | null;
  lifecycleDeps?: Partial<SandboxTaskLifecycleDeps>;
}) {
  const lifecycle = createSandboxTaskLifecycle({
    userId: input.userId,
    userText: input.userText,
    binding: {
      sandboxId: input.sandboxId ?? null,
      status: input.sandboxId ? "running" : "unavailable",
    },
    deps: input.lifecycleDeps,
  });

  return {
    onToolStart: lifecycle.onToolStart,
    onToolFinish: lifecycle.onToolFinish,
    cleanup: lifecycle.cleanup,
    async finalize(finalText: string) {
      const text = sanitizeAgentUserFacingText(finalText, {
        repoName: input.repoName,
        userRequestText: input.userText,
      });
      const footer = await lifecycle.footer();
      return [text, footer].filter(Boolean).join("\n\n");
    },
  };
}
