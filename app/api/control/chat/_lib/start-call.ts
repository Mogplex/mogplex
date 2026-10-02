import type { ControlBackgroundExecution } from "@/lib/control/background-context";
import { createAiCall } from "@/lib/interactive-runs";
import { buildControlChatRunMetadata, getControlChatRunScope } from "./context";
import type { ControlChatRequestBody } from "./types";

export async function createControlAiCall(
  input: {
    userId: string;
    body: ControlChatRequestBody;
    resolvedModel: string;
    limitClaimId: string | null;
    callStartedAt: string;
    background?: ControlBackgroundExecution;
  },
  teamId: string | null
) {
  const scope = getControlChatRunScope(input.body);
  return createAiCall({
    userId: input.userId,
    type: "agent",
    model: input.resolvedModel,
    conversationId: scope.conversationId,
    repoId: scope.repoId,
    limitClaimId: input.limitClaimId,
    startedAt: input.callStartedAt,
    status: "pending",
    metadata: buildControlChatRunMetadata(
      input.body,
      teamId,
      input.background ? "background" : "request"
    ),
  });
}
