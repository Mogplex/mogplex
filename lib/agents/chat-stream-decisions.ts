import { createTurnDecisionObserver } from "@/lib/decisions/turn-observer";
import type { DecisionStep } from "@/lib/decisions/turn";
import type { DecisionScope } from "@/lib/decisions/types";
import type { ChatModelStreamHooks } from "./run-chat";

/**
 * Attach the decision layer's turn checks to a chat stream. Caller hooks run
 * first and unchanged; the checks never delay a step and never fail a turn.
 */
export function withChatStreamDecisions(
  hooks: ChatModelStreamHooks | undefined,
  scope: DecisionScope
): ChatModelStreamHooks {
  const observer = createTurnDecisionObserver(scope);
  const steps: DecisionStep[] = [];
  return {
    ...hooks,
    async onStepEnd(event) {
      steps.push(event as unknown as DecisionStep);
      observer.onStep(steps);
      await hooks?.onStepEnd?.(event);
    },
    async onEnd(event) {
      try {
        await hooks?.onEnd?.(event);
      } finally {
        if (event.finishReason !== "error") {
          observer
            .onEnd(event.steps as unknown as DecisionStep[])
            .catch(() => undefined);
        }
      }
    },
  };
}
