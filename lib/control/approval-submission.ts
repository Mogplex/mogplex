import { isToolOrDynamicToolUIPart, type UIMessage } from "ai";

/** One automatic submission per explicit approval click. A persisted message
 * can retain pending approvals before a later continuation's step boundary. */
export function createControlApprovalSubmission() {
  const requested = new Set<string>();
  return {
    request(messages: UIMessage[], id: string) {
      const last = messages.at(-1);
      if (
        last?.role === "assistant" &&
        last.parts.some(
          (part) =>
            isToolOrDynamicToolUIPart(part) &&
            part.state === "approval-requested" &&
            part.approval.id === id
        )
      )
        requested.add(id);
    },
    shouldSubmit({ messages }: { messages: UIMessage[] }) {
      const last = messages.at(-1);
      if (last?.role !== "assistant") return false;
      const tools = last.parts.filter(isToolOrDynamicToolUIPart);
      const decisions = tools.flatMap((part) =>
        part.state === "approval-responded" && requested.has(part.approval.id)
          ? [part.approval.id]
          : []
      );
      if (
        decisions.length === 0 ||
        tools.some(
          (part) =>
            ![
              "output-available",
              "output-error",
              "output-denied",
              "approval-responded",
            ].includes(part.state)
        )
      )
        return false;
      for (const id of decisions) requested.delete(id);
      return true;
    },
  };
}
