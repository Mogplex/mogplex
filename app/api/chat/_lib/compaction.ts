import { randomUUID } from "node:crypto";
import {
  COMPACTION_CHAR_BUDGET,
  compactConversation,
  estimateMessagesChars,
  type CompactableAgentMessage,
} from "@/lib/agents/compaction";
import {
  loadLatestCompaction,
  persistCompactionEvent,
} from "@/lib/agents/compaction/store";
import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";

/**
 * Conversation-level compaction for the HTTP chat route. Runs before the
 * stream starts; the client keeps its full transcript (audit/replay), while
 * the model input is rebuilt as [checkpoint handoff, recent turns].
 *
 * Invisible by design: no stream interruption, no chat bubble. The audit
 * trail lives in `ai_call_events`, where the newest valid checkpoint is also
 * the reuse candidate that keeps subsequent turns from re-summarizing.
 */

type ChatUiMessage = CompactableAgentMessage & { role: string };

function buildHandoffUiMessage(handoffText: string): ChatUiMessage {
  return {
    id: `compaction-${randomUUID()}`,
    role: "user",
    parts: [{ type: "text", text: handoffText }],
  };
}

export async function compactChatMessagesForModel(input: {
  userId: string;
  conversationId: string | null;
  repoId?: string | null;
  aiCallId: string;
  resolvedModel: string;
  teamId: string | null;
  uiMessages: ChatUiMessage[];
  abortSignal?: AbortSignal;
}): Promise<ChatUiMessage[]> {
  // Without a conversation id there is nowhere to persist or reuse a
  // checkpoint, and re-summarizing every turn would be pure cost.
  if (!input.conversationId) return input.uiMessages;
  if (estimateMessagesChars(input.uiMessages) <= COMPACTION_CHAR_BUDGET) {
    return input.uiMessages;
  }

  try {
    const previous = await loadLatestCompaction({
      userId: input.userId,
      conversationId: input.conversationId,
    });

    const { model } = await resolveUserLanguageModel(
      input.userId,
      input.resolvedModel,
      {
        gatewayContext: {
          userId: input.userId,
          tags: ["surface:compaction"],
          caching: "off",
        },
        teamId: input.teamId,
      }
    );

    const result = await compactConversation<ChatUiMessage>({
      messages: input.uiMessages,
      model,
      compactorModelId: input.resolvedModel,
      previous,
      buildHandoffMessage: buildHandoffUiMessage,
      abortSignal: input.abortSignal,
    });

    if (result.outcome === "compacted") {
      await persistCompactionEvent({
        aiCallId: input.aiCallId,
        userId: input.userId,
        conversationId: input.conversationId,
        repoId: input.repoId ?? null,
        payload: result.event,
      });
      return result.messages;
    }
    if (result.outcome === "failed") {
      if (result.event) {
        await persistCompactionEvent({
          aiCallId: input.aiCallId,
          userId: input.userId,
          conversationId: input.conversationId,
          repoId: input.repoId ?? null,
          payload: result.event,
        });
      }
      // Degrade to today's behavior: send the history unchanged. A worse
      // context beats a wrong one; the provider window is still far away.
      console.warn("[compaction] chat compaction failed", {
        conversationId: input.conversationId,
        error: result.error,
      });
      return input.uiMessages;
    }
    return result.messages;
  } catch (error) {
    console.error("[compaction] chat compaction errored", {
      conversationId: input.conversationId,
      error,
    });
    return input.uiMessages;
  }
}
