import type { LanguageModel } from "ai";
import {
  promoteMemoriesForConversation,
  type PromotionTurnRecord,
} from "@/lib/agents/memory-promotion-runner";
import type { ControlMemoryContext } from "@/lib/agents/control-memory-context";
import { observeMemoryRelevance } from "@/lib/decisions/memory-relevance";
import { observeSkillSelection } from "@/lib/decisions/skills";
import { createTurnDecisionObserver } from "@/lib/decisions/turn-observer";
import type { DecisionStep } from "@/lib/decisions/turn";
import type { ConversationSkills } from "@/lib/skill-catalog/chat";

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
  /** Injectable for tests; production uses the decision layer. */
  observeMemories?: typeof observeMemoryRelevance;
  observeSkills?: typeof observeSkillSelection;
}) {
  const scope = {
    surface: "control",
    userId: input.userId,
    teamId: input.teamId,
    repoId: input.repoId,
    aiCallId: input.aiCallId,
    conversationId: input.conversationId,
  };
  const observer = createTurnDecisionObserver(scope);
  let memoryCheck: Promise<void> = Promise.resolve();
  let skillCheck: Promise<void> = Promise.resolve();

  return {
    /**
     * Starts the relevance check on the memories the prompt just received and
     * returns at once. It runs beside the turn and is awaited when the turn
     * ends, so it never delays the first token and is not dropped either.
     */
    onMemoriesSelected(selected: ControlMemoryContext) {
      memoryCheck = (input.observeMemories ?? observeMemoryRelevance)({
        request: input.userText,
        groups: selected,
        scope,
      });
    },
    /** The same arrangement for the operator's skills: beside, then awaited. */
    onSkillsResolved(skills: ConversationSkills) {
      skillCheck = (input.observeSkills ?? observeSkillSelection)({
        catalog: {
          skills: skills.available,
          invokedIds: skills.invoked.map((skill) => skill.id),
        },
        request: input.userText,
        delivery: "inline",
        scope,
      });
    },
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
      await Promise.all([
        observer.onEnd(end.steps as unknown as DecisionStep[]),
        memoryCheck,
        skillCheck,
      ]);
    },
  };
}
