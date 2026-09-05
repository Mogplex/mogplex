import { isToolUIPart, type UIMessage } from "ai";
import type { AiCall } from "@/lib/types";
import { markInterruptedChatResponse } from "./chat-stream";

type ChatRunState = Pick<AiCall, "id" | "type" | "status" | "conversation_id">;

export function savedChatCallId(message: UIMessage): string | null {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object" || !("ai_call_id" in metadata))
    return null;
  return typeof metadata.ai_call_id === "string" ? metadata.ai_call_id : null;
}

export function needsChatHistoryRecovery(message: UIMessage): boolean {
  return (
    message.role === "assistant" &&
    Boolean(savedChatCallId(message)) &&
    message.parts.some(
      (part) =>
        (isToolUIPart(part) &&
          (part.state === "input-streaming" ||
            part.state === "input-available")) ||
        ((part.type === "text" || part.type === "reasoning") &&
          part.state === "streaming")
    )
  );
}

/** A terminal model run is not proof that its command succeeded or stopped. */
export function reconcileChatHistory(
  messages: UIMessage[],
  calls: ChatRunState[],
  conversationId: string
): UIMessage[] {
  const terminalIds = new Set(
    calls
      .filter(
        (call) =>
          call.conversation_id === conversationId &&
          call.type === "chat" &&
          (call.status === "failed" ||
            call.status === "cancelled" ||
            call.status === "success")
      )
      .map((call) => call.id)
  );
  let changed = false;
  const reconciled = messages.map((message) => {
    if (
      !needsChatHistoryRecovery(message) ||
      !terminalIds.has(savedChatCallId(message)!)
    )
      return message;
    changed = true;
    return markInterruptedChatResponse([message], message.id)[0];
  });
  return changed ? reconciled : messages;
}
