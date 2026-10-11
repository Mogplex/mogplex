import type { LanguageModelUsage, ProviderMetadata } from "ai";
import {
  captureUsage,
  mergeUsage,
  EMPTY_CAPTURED_USAGE,
  capturedUsageAiCallColumns,
} from "@/lib/observability/usage";
import { updateAiCallIfActive } from "@/lib/interactive-runs";
import type { ActiveControlCall } from "@/app/api/control/chat/_lib/types";

export function createControlStepCheckpoint(call: ActiveControlCall) {
  let usage = EMPTY_CAPTURED_USAGE;
  return async (step: {
    usage?: LanguageModelUsage;
    providerMetadata?: ProviderMetadata;
  }) => {
    const captured = captureUsage(step.usage, step.providerMetadata);
    if (
      !step.usage &&
      captured.generationIds.every((id) => usage.generationIds.includes(id))
    )
      return;
    usage = mergeUsage(usage, captured);
    Object.assign(call, capturedUsageAiCallColumns(usage));
    await updateAiCallIfActive(call.id, {
      ...capturedUsageAiCallColumns(usage),
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
