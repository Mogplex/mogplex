import { isToolOrDynamicToolUIPart, type UIMessage } from "ai";

/** Saved evidence is authoritative; only explicit responses to pending approvals
 * may change an existing assistant part in a new browser request. */
export function controlRequestHistory(
  saved: UIMessage[],
  incoming: UIMessage[]
): UIMessage[] {
  const byId = new Map(incoming.map((message) => [message.id, message]));
  return saved.map((message) => {
    const submitted = byId.get(message.id);
    if (message.role !== "assistant" || submitted?.role !== "assistant")
      return message;
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (
          !isToolOrDynamicToolUIPart(part) ||
          part.state !== "approval-requested"
        )
          return part;
        const response = submitted.parts.find(
          (candidate) =>
            isToolOrDynamicToolUIPart(candidate) &&
            candidate.type === part.type &&
            candidate.toolCallId === part.toolCallId &&
            candidate.state === "approval-responded" &&
            candidate.approval.id === part.approval.id
        );
        if (
          !response ||
          !isToolOrDynamicToolUIPart(response) ||
          response.state !== "approval-responded"
        )
          return part;
        return {
          ...part,
          state: "approval-responded" as const,
          approval: response.approval,
        };
      }),
    };
  });
}
