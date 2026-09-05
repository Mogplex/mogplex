import { isToolOrDynamicToolUIPart } from "ai";
import { prepareControlRequestHistory } from "@/lib/control/request-history";
import { saveControlTranscript } from "@/lib/control/transcript-store";
import { validateControlChatMessages } from "./messages";
import type { ControlChatRequestBody } from "./types";

export async function prepareControlExecutionHistory(input: {
  userId: string;
  sessionId: string | null;
  aiCallId: string;
  messages: ControlChatRequestBody["messages"];
}) {
  const uiMessages = await validateControlChatMessages(input.messages);
  if (input.sessionId) {
    const saved = await saveControlTranscript({
      userId: input.userId,
      sessionId: input.sessionId,
      messages: uiMessages,
    });
    const prepared = await prepareControlRequestHistory({
      userId: input.userId,
      sessionId: input.sessionId,
      aiCallId: input.aiCallId,
      savedMessages: saved.messages,
      incomingMessages: uiMessages,
    });
    return {
      uiMessages: await validateControlChatMessages(prepared.messages),
      expectedMessages: saved.messages,
      continuationMessageId: prepared.continuationMessageId,
      claimedApprovalIds: prepared.claimedApprovalIds,
      completeApproval: prepared.complete,
    };
  }
  if (
    uiMessages.some((message) =>
      message.parts.some(
        (part) =>
          isToolOrDynamicToolUIPart(part) && part.state === "approval-responded"
      )
    )
  ) {
    throw new Error("Approve actions from a saved Control conversation.");
  }
  return {
    uiMessages,
    expectedMessages: uiMessages,
    continuationMessageId: undefined,
    claimedApprovalIds: [] as string[],
    completeApproval: undefined,
  };
}
