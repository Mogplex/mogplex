import { createTurnDecisionObserver } from "@/lib/decisions/turn-observer";
import type { DecisionStep } from "@/lib/decisions/turn";
import type { DecisionScope } from "@/lib/decisions/types";
import type { ChatModelStreamHooks } from "./run-chat";

/**
 * Attach the decision layer's turn checks to a chat stream. Caller hooks run
 * first and unchanged; the checks never delay a step and never fail a turn.
 * The end-of-turn check is awaited so it completes before the process can.
 */
export function withChatStreamDecisions(
  hooks: ChatModelStreamHooks | undefined,
  scope: DecisionScope,
  createObserver: typeof createTurnDecisionObserver = createTurnDecisionObserver
): ChatModelStreamHooks {
  const observer = createObserver(scope);
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
        // Awaited on purpose: API and Slack runs execute in workers that exit
        // with the turn, and an unawaited check was lost there in production.
        // The observer never rejects and is bounded by the decision timeouts.
        if (event.finishReason !== "error") {
          await observer.onEnd(event.steps as unknown as DecisionStep[]);
        }
      }
    },
  };
}
