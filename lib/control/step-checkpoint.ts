import type { LanguageModelUsage, ProviderMetadata } from "ai";
import {
  captureUsage,
  mergeUsage,
  EMPTY_CAPTURED_USAGE,
} from "@/lib/observability/usage";
import { updateAiCallIfActive } from "@/lib/interactive-runs";
import type { ActiveControlCall } from "@/app/api/control/chat/_lib/types";

export function createControlStepCheckpoint(call: ActiveControlCall) {
  let usage = EMPTY_CAPTURED_USAGE;
  return async (step: {
    usage: LanguageModelUsage;
    providerMetadata?: ProviderMetadata;
  }) => {
    usage = mergeUsage(usage, captureUsage(step.usage, step.providerMetadata));
    Object.assign(call, {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_input_tokens: usage.cacheReadInputTokens,
      cache_creation_input_tokens: usage.cacheCreationInputTokens,
      reasoning_tokens: usage.reasoningTokens,
      gateway_generation_id: usage.generationId,
    });
    await updateAiCallIfActive(call.id, {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_input_tokens: usage.cacheReadInputTokens,
      cache_creation_input_tokens: usage.cacheCreationInputTokens,
      reasoning_tokens: usage.reasoningTokens,
      gateway_generation_id: usage.generationId,
      metadata: {
        ...call.metadata,
        gateway_generation_ids: usage.generationIds,
      },
    });
    call.metadata = {
      ...call.metadata,
      gateway_generation_ids: usage.generationIds,
    };
  };
}
