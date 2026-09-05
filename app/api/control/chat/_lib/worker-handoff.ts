import type { UIMessage } from "ai";
import { createControlWorkerHandoff } from "@/lib/control/worker-handoff";
import { controlContinuationContextSchema } from "@/lib/control/continuation-store";
import type { ControlChatRequestBody, ControlChatRunScope } from "./types";

export function prepareControlWorkerHandoff(
  input: {
    userId: string;
    body: ControlChatRequestBody;
    resolvedModel: string;
  },
  scope: ControlChatRunScope,
  aiCallId: string,
  messages: UIMessage[],
  teamId: string | null,
  sandboxBinding: { sandboxId: string | null }
) {
  if (!scope.missionId || !scope.repoId || input.body.mode === "plan")
    return undefined;
  return createControlWorkerHandoff({
    userId: input.userId,
    sessionId: scope.missionId,
    parentAiCallId: aiCallId,
    messages,
    sandboxBinding,
    context: controlContinuationContextSchema.parse({
      ...input.body,
      model: input.resolvedModel,
      missionId: scope.missionId,
      repoId: scope.repoId,
      conversationId: scope.missionId,
      teamId,
      mode: "run",
    }),
  });
}
