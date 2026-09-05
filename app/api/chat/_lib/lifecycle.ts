import type { ChatModelStreamHooks } from "@/lib/agents/run-chat";
import {
  captureUsage,
  mergeUsage,
  EMPTY_CAPTURED_USAGE,
} from "@/lib/observability/usage";
import {
  finalizeCancelledChatRun,
  finalizeFinishedChatRun,
} from "./finalization";

type ChatFinalizationInput = Omit<
  Parameters<typeof finalizeCancelledChatRun>[0],
  "steps"
>;

/** One terminal result per response, even when SDK terminal callbacks overlap. */
export function createChatFinalizationHooks(
  input: ChatFinalizationInput
): ChatModelStreamHooks {
  let finalized = false;
  const completedSteps: Parameters<typeof finalizeFinishedChatRun>[0]["steps"] =
    [];
  let capturedUsage = EMPTY_CAPTURED_USAGE;
  return {
    onStepFinish(step) {
      completedSteps.push(step);
      capturedUsage = mergeUsage(
        capturedUsage,
        captureUsage(step.usage, step.providerMetadata)
      );
    },
    async onError() {
      if (finalized) return;
      finalized = true;
      await finalizeFinishedChatRun({
        ...input,
        finishReason: "error",
        steps: completedSteps,
        capturedUsage,
        totalUsage: {
          inputTokens: capturedUsage.inputTokens,
          outputTokens: capturedUsage.outputTokens,
        },
      });
    },
    async onAbort({ steps }) {
      if (finalized) return;
      finalized = true;
      await finalizeCancelledChatRun({ ...input, steps });
    },
    async onFinish({ totalUsage, steps, finishReason, providerMetadata }) {
      if (finalized) return;
      finalized = true;
      await finalizeFinishedChatRun({
        ...input,
        totalUsage,
        steps,
        finishReason,
        providerMetadata,
      });
    },
  };
}
