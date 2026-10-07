import type { generateText } from "ai";
import type {
  JobContext,
  AutomationLanguageModel,
} from "./automation-job-types";
import type { ReviewCheckpointGenerate } from "./pr-review-checkpoint";
import type { ReportRepairRequest } from "./pr-review-report-repair";
import { executeAutomationTextGeneration } from "./automation-model-execution";
import { normalizeAutomationAgentResult } from "./automation-job-metadata";

/** Shared generation contract for a review, its continuation and report repair. */
export function createAutomationTextGenerator(input: {
  context: JobContext;
  resolvedModel: AutomationLanguageModel;
  phase: string;
  generateText: typeof generateText;
  instructions: Parameters<typeof generateText>[0]["instructions"];
}) {
  type Ask = Parameters<ReviewCheckpointGenerate>[0] | ReportRepairRequest;
  return async (request: Ask) => {
    const { result, metadata } = await executeAutomationTextGeneration({
      phase: input.phase,
      requestedModelId: input.resolvedModel.effectiveModelId,
      pinnedModelId: input.context.agent.model,
      generateText: input.generateText,
      timeoutMs: input.context.agent.timeout_ms,
      request: {
        model: input.resolvedModel.model,
        providerOptions: input.resolvedModel.providerOptions,
        instructions: input.instructions,
        ...request,
        stopWhen: () => false,
      },
    });
    return {
      responseMessages: result.response?.messages,
      normalized: normalizeAutomationAgentResult({
        text: result.text,
        steps: result.steps,
        totalUsage: result.totalUsage,
        execution: metadata,
      }),
    };
  };
}
