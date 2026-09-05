import { isToolOrDynamicToolUIPart, type UIMessage } from "ai";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function prepareControlRequestHistory(
  input: {
    userId: string;
    sessionId: string;
    aiCallId: string;
    savedMessages: UIMessage[];
    incomingMessages: UIMessage[];
  },
  client = supabaseAdmin
) {
  const messages = controlRequestHistory(
    input.savedMessages,
    input.incomingMessages
  );
  const submitted = input.incomingMessages.at(-1);
  const decisions =
    submitted?.role === "assistant"
      ? submitted.parts.filter(
          (part) =>
            isToolOrDynamicToolUIPart(part) &&
            part.state === "approval-responded"
        )
      : [];
  if (decisions.length === 0)
    return {
      messages,
      continuationMessageId: undefined,
      claimedApprovalIds: [] as string[],
      complete: undefined,
    };
  const expected = input.savedMessages.find(
    (message) => message.id === submitted!.id
  );
  const response = messages.find((message) => message.id === submitted!.id);
  const pendingIds = new Set(
    expected?.parts.flatMap((part) =>
      isToolOrDynamicToolUIPart(part) && part.state === "approval-requested"
        ? [part.approval.id]
        : []
    )
  );
  const approvalIds =
    response?.parts.flatMap((part) =>
      isToolOrDynamicToolUIPart(part) &&
      part.state === "approval-responded" &&
      pendingIds.has(part.approval.id)
        ? [part.approval.id]
        : []
    ) ?? [];
  const conflict = () =>
    new Error(
      "This approval was already submitted or changed, or another action in this message is still finishing. Reload the conversation to check its result; do not replay it."
    );
  if (
    !expected ||
    expected.id !== input.savedMessages.at(-1)?.id ||
    approvalIds.length !== decisions.length
  )
    throw conflict();
  const { data, error } = await client.rpc("control_claim_approvals", {
    p_user_id: input.userId,
    p_session_id: input.sessionId,
    p_message_id: submitted!.id,
    p_approval_ids: approvalIds,
    p_ai_call_id: input.aiCallId,
    p_expected_message: expected,
  });
  if (error)
    throw new Error(
      "Could not claim this approval. No approved action was started."
    );
  if (data !== true) throw conflict();
  return {
    messages,
    continuationMessageId: submitted!.id,
    claimedApprovalIds: approvalIds,
    complete: async () => {
      const { data: finished, error: finishError } = await client.rpc(
        "control_finish_approval_continuation",
        {
          p_user_id: input.userId,
          p_session_id: input.sessionId,
          p_message_id: submitted!.id,
          p_ai_call_id: input.aiCallId,
        }
      );
      if (finishError || finished !== true)
        throw new Error(
          "Could not finish the approval continuation. Reload the conversation to inspect its saved result."
        );
    },
  };
}

/** Inference-only projection: an unresolved historical approval is not a new
 * instruction to execute. Keep the durable/UI message unchanged. */
export function controlMessagesForModel(
  messages: UIMessage[],
  claimedApprovalIds: string[] = []
): UIMessage[] {
  const claimed = new Set(claimedApprovalIds);
  return messages.map((message) => {
    const parts = message.parts.map((part) => {
      if (
        isToolOrDynamicToolUIPart(part) &&
        (part.state === "approval-requested" ||
          (part.state === "approval-responded" &&
            !claimed.has(part.approval.id)))
      )
        return {
          type: "text" as const,
          text: `Tool call ${part.toolCallId} has no recorded result. Its approval is pending or was already submitted. Do not replay it; inspect the existing run for status.`,
        };
      return part;
    });
    const decisions = parts.filter(
      (part) =>
        isToolOrDynamicToolUIPart(part) &&
        part.state === "approval-responded" &&
        claimed.has(part.approval.id)
    );
    // The SDK executes approvals only from the last model tool message.
    // A newly claimed older-step decision must follow any later commentary.
    // Move it in inference only; preserve the original durable/UI ordering.
    return {
      ...message,
      parts:
        decisions.length > 0
          ? [
              ...parts.filter((part) => !decisions.includes(part)),
              { type: "step-start" as const },
              ...decisions,
            ]
          : parts,
    };
  });
}

/** Saved evidence is authoritative; only explicit responses to pending approvals
 * may change an existing assistant part in a new browser request. */
export function controlRequestHistory(
  saved: UIMessage[],
  incoming: UIMessage[]
): UIMessage[] {
  const last = incoming.at(-1);
  return saved.map((message) => {
    const submitted =
      last?.id === message.id && last.role === "assistant" ? last : undefined;
    if (message.role !== "assistant") return message;
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (
          !isToolOrDynamicToolUIPart(part) ||
          part.state !== "approval-requested" ||
          !submitted
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
