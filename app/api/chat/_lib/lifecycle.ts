import type { ChatModelStreamHooks } from "@/lib/agents/run-chat";
import { updateAiCall } from "@/lib/interactive-runs";
import {
  captureUsage,
  mergeUsage,
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
} from "@/lib/observability/usage";
import {
  finalizeCancelledChatRun,
  finalizeFinishedChatRun,
} from "./finalization";

type ChatFinalizationInput = Omit<
  Parameters<typeof finalizeCancelledChatRun>[0],
  "steps" | "capturedUsage"
>;

/** One terminal result per response, even when SDK terminal callbacks overlap. */
export function createChatFinalizationHooks(
  input: ChatFinalizationInput
): ChatModelStreamHooks {
  let finalized = false;
  let terminalWrite: Promise<void> | undefined;
  const completedSteps: Parameters<typeof finalizeFinishedChatRun>[0]["steps"] =
    [];
  let capturedUsage = EMPTY_CAPTURED_USAGE;
  return {
    async onChunk({ chunk }) {
      // Gateway attaches the generation ID before completion. Retain it even
      // when an interrupted request never reaches onStepEnd.
      if ("providerMetadata" in chunk) {
        const previousIds = capturedUsage.generationIds.length;
        capturedUsage = fillUsageGaps(
          capturedUsage,
          captureUsage(undefined, chunk.providerMetadata)
        );
        // The SDK can call onError upstream before buffered content reaches
        // onChunk. Append late IDs after the terminal write without changing
        // its status, timestamps, or event. Chunk callbacks are serialized.
        if (finalized && capturedUsage.generationIds.length > previousIds) {
          await terminalWrite;
          await updateAiCall(input.activeCall.id, {
            gateway_generation_id: capturedUsage.generationId,
            gateway_generation_ids: capturedUsage.generationIds,
          });
        }
      }
    },
    onStepEnd(step) {
      completedSteps.push(step);
      capturedUsage = mergeUsage(
        capturedUsage,
        captureUsage(step.usage, step.providerMetadata)
      );
    },
    async onError() {
      if (finalized) return;
      finalized = true;
      terminalWrite = finalizeFinishedChatRun({
        ...input,
        finishReason: "error",
        steps: completedSteps,
        capturedUsage,
        totalUsage: {
          inputTokens: capturedUsage.inputTokens,
          outputTokens: capturedUsage.outputTokens,
        },
      });
      await terminalWrite;
    },
    async onAbort({ steps }) {
      if (finalized) return;
      finalized = true;
      terminalWrite = finalizeCancelledChatRun({
        ...input,
        steps,
        capturedUsage,
      });
      await terminalWrite;
    },
    async onEnd({ totalUsage, steps, finishReason, providerMetadata }) {
      if (finalized) return;
      finalized = true;
      terminalWrite = finalizeFinishedChatRun({
        ...input,
        totalUsage,
        steps,
        finishReason,
        providerMetadata,
        capturedUsage: fillUsageGaps(
          capturedUsage,
          captureUsage(totalUsage, providerMetadata)
        ),
      });
      await terminalWrite;
    },
  };
}
