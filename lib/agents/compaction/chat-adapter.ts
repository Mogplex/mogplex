import { randomUUID } from "node:crypto";
import {
  COMPACTION_CHAR_BUDGET,
  COMPACTION_KEEP_RECENT_MESSAGES,
  compactConversation,
  estimateMessagesChars,
  type CheckpointGenerator,
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

// The handoff replaces compacted history and must be readable as a user turn
// by every caller's message shape; `id` + text parts satisfy both the chat
// route's UIMessages and the control route's narrower part type. The cast is
// the one place the adapter bridges its fixed handoff shape to the caller's
// generic message type.
function buildHandoffUiMessage<Message extends ChatUiMessage>(
  handoffText: string
): Message {
  return {
    id: `compaction-${randomUUID()}`,
    role: "user",
    parts: [{ type: "text", text: handoffText }],
  } as Message;
}

/**
 * Boundary dependencies, injectable for tests (repo rule: DI over mocking —
 * these resolve to the real store / model-resolver in production).
 */
export type ChatCompactionDeps = {
  loadLatestCompaction: typeof loadLatestCompaction;
  persistCompactionEvent: typeof persistCompactionEvent;
  resolveModel: typeof resolveUserLanguageModel;
  generate?: CheckpointGenerator;
  charBudget?: number;
  keepRecent?: number;
};

const defaultDeps: ChatCompactionDeps = {
  loadLatestCompaction,
  persistCompactionEvent,
  resolveModel: resolveUserLanguageModel,
};

export async function compactChatMessagesForModel<
  Message extends ChatUiMessage,
>(
  input: {
    userId: string;
    conversationId: string | null;
    repoId?: string | null;
    aiCallId: string;
    resolvedModel: string;
    teamId: string | null;
    uiMessages: Message[];
    abortSignal?: AbortSignal;
  },
  deps: ChatCompactionDeps = defaultDeps
): Promise<Message[]> {
  const charBudget = deps.charBudget ?? COMPACTION_CHAR_BUDGET;
  // Without a conversation id there is nowhere to persist or reuse a
  // checkpoint, and re-summarizing every turn would be pure cost.
  if (!input.conversationId) return input.uiMessages;
  if (estimateMessagesChars(input.uiMessages) <= charBudget) {
    return input.uiMessages;
  }

  try {
    const previous = await deps.loadLatestCompaction({
      userId: input.userId,
      conversationId: input.conversationId,
    });

    const { model } = await deps.resolveModel(
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

    const result = await compactConversation<Message>({
      messages: input.uiMessages,
      model,
      compactorModelId: input.resolvedModel,
      previous,
      buildHandoffMessage: buildHandoffUiMessage,
      abortSignal: input.abortSignal,
      generate: deps.generate,
      charBudget,
      keepRecent: deps.keepRecent ?? COMPACTION_KEEP_RECENT_MESSAGES,
    });

    if (result.outcome === "compacted") {
      await deps.persistCompactionEvent({
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
        await deps.persistCompactionEvent({
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
