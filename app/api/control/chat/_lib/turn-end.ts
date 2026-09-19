import type { LanguageModel } from "ai";
import {
  promoteMemoriesForConversation,
  type PromotionTurnRecord,
} from "@/lib/agents/memory-promotion-runner";
import { createTurnDecisionObserver } from "@/lib/decisions/turn-observer";
import type { DecisionStep } from "@/lib/decisions/turn";

type TurnSteps = PromotionTurnRecord["steps"];

/**
 * Work that follows a Control turn without touching the finished run: memory
 * promotion, and the decision layer's loop and claim checks. Everything here
 * is best-effort and fire-and-forget.
 */
export function createControlTurnTasks(input: {
  userId: string;
  teamId: string | null;
  conversationId: string | null;
  repoId: string | null;
  aiCallId: string;
  userText: string;
}) {
  const observer = createTurnDecisionObserver({
    surface: "control",
    userId: input.userId,
    teamId: input.teamId,
    repoId: input.repoId,
    aiCallId: input.aiCallId,
    conversationId: input.conversationId,
  });

  return {
    onStep(steps: TurnSteps) {
      observer.onStep(steps as unknown as DecisionStep[]);
    },
    /**
     * Promotion stays fire-and-forget because it can take many seconds. The
     * claim check is short and awaited, so a function that freezes once the
     * response closes cannot drop it.
     */
    async onEnd(end: { model: LanguageModel; steps: TurnSteps }) {
      // Distill durable facts from the checkpoint, or from this turn when
      // none exists.
      promoteMemoriesForConversation({
        userId: input.userId,
        teamId: input.teamId,
        conversationId: input.conversationId,
        repoId: input.repoId,
        aiCallId: input.aiCallId,
        model: end.model,
        turn: { userText: input.userText, steps: end.steps },
      }).catch((error: unknown) => {
        console.warn("[memory-promotion] failed", {
          conversationId: input.conversationId,
          error,
        });
      });
      await observer.onEnd(end.steps as unknown as DecisionStep[]);
    },
  };
}
