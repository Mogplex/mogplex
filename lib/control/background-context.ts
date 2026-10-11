import type { Tool } from "ai";
import type { SandboxCommandExecution } from "@/lib/agents/tools/sandbox";

/** Server-only execution hooks. Never accepted from a chat request body. */
export type ControlBackgroundExecution = {
  assertCurrent: () => Promise<void>;
  onAiCallStarted: (aiCallId: string) => Promise<void>;
  systemContext: string;
  sandboxExecution: SandboxCommandExecution;
  expectedContext: Pick<
    import("@/app/api/control/chat/_lib/types").ControlChatRequestBody,
    "repoId" | "missionId" | "model"
  >;
  onTranscriptComplete: (
    event: import("./persisted-stream").ControlStreamCompletion
  ) => Promise<void>;
};

export function guardControlBackgroundTools(
  tools: Record<string, Tool>,
  guard?: () => Promise<void>
): Record<string, Tool> {
  if (!guard) return tools;
  return Object.fromEntries(
    Object.entries(tools).map(([name, value]) => {
      const execute = value.execute;
      if (!execute) return [name, value];
      return [
        name,
        {
          ...value,
          execute: async (...args: Parameters<typeof execute>) => {
            args[1].abortSignal?.throwIfAborted();
            await guard();
            return execute(...args);
          },
        },
      ];
    })
  );
}
