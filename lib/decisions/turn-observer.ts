import {
  buildClaimNotice,
  checkForLoop,
  LOOP_WINDOW_SIZE,
  verifyTurnClaims,
  type DecisionStep,
} from "./turn";
import type { DecisionScope } from "./types";

export type TurnObserverDeps = {
  verifyClaims: typeof verifyTurnClaims;
  checkLoop: typeof checkForLoop;
  /** Writes the notice where the run's activity feed will show it. */
  appendNotice: (input: {
    aiCallId: string;
    userId: string;
    conversationId: string | null;
    repoId: string | null;
    message: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
};

const defaultDeps: TurnObserverDeps = {
  verifyClaims: verifyTurnClaims,
  checkLoop: checkForLoop,
  appendNotice: async (input) => {
    const mod = await import("@/lib/interactive-runs");
    await mod.appendAiCallEvent({
      aiCallId: input.aiCallId,
      userId: input.userId,
      conversationId: input.conversationId,
      repoId: input.repoId,
      eventType: "log",
      message: input.message,
      payload: input.payload,
    });
  },
};

function countToolCalls(steps: readonly DecisionStep[]): number {
  return steps.reduce((sum, step) => sum + (step.toolCalls?.length ?? 0), 0);
}

export type TurnDecisionObserver = {
  /** Call after each step with every step so far. Never blocks the loop. */
  onStep: (steps: readonly DecisionStep[]) => void;
  /** Call once when the turn finishes normally. Resolves when checks settle. */
  onEnd: (steps: readonly DecisionStep[]) => Promise<void>;
};

/**
 * Watches one agent turn. Loop checks run in the background as tool calls
 * accumulate and only record what they see: by policy nothing here may end or
 * shorten a run. When the turn ends, the final message is checked against the
 * tool log and an unsupported claim becomes a notice on the run.
 */
export function createTurnDecisionObserver(
  scope: DecisionScope,
  deps: TurnObserverDeps = defaultDeps
): TurnDecisionObserver {
  let checkedToolCalls = 0;

  return {
    onStep(steps) {
      const toolCalls = countToolCalls(steps);
      if (toolCalls < LOOP_WINDOW_SIZE || toolCalls === checkedToolCalls)
        return;
      checkedToolCalls = toolCalls;
      deps.checkLoop({ steps: [...steps], scope }).catch((error: unknown) => {
        console.warn("[decisions] loop check failed", { error });
      });
    },
    async onEnd(steps) {
      try {
        const result = await deps.verifyClaims({ steps, scope });
        if (!result || !scope.aiCallId || !scope.userId) return;
        await deps.appendNotice({
          aiCallId: scope.aiCallId,
          userId: scope.userId,
          conversationId: scope.conversationId ?? null,
          repoId: scope.repoId ?? null,
          message: buildClaimNotice(result.unsupported),
          payload: { check: "claim_verification", ...result },
        });
      } catch (error) {
        console.warn("[decisions] claim verification failed", { error });
      }
    },
  };
}
