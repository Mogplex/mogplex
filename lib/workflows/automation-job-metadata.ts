/**
 * Execution metadata helpers for the automation job workflow.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import {
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
  hasCapturedUsage,
  mergeUsage,
  type CapturedUsage,
} from "@/lib/observability/usage";
import {
  previewTelemetryValue,
  sanitizeTelemetryValue as sanitizeToolPayload,
} from "@/lib/ai-telemetry";
import { sumNullableNumbers } from "@/lib/workflows/automation-job-utils";
import type {
  AutomationAgentResult,
  AutomationJobModelFailureDiagnostics,
  JobRunRuntimeDetails,
} from "@/lib/workflows/automation-job-types";
import type { AutomationModelExecutionMetadata } from "@/lib/workflows/automation-model-execution-types";
import type { BackgroundRuntimeProvider } from "@/lib/runtime-providers";

export function mergeAutomationExecutionMetadata(
  results: AutomationAgentResult[]
): AutomationModelExecutionMetadata | null {
  const executions = results
    .map((result) => result.execution)
    .filter(
      (execution): execution is AutomationModelExecutionMetadata =>
        execution != null
    );

  if (executions.length === 0) {
    return null;
  }

  const recoveredExecution =
    executions.find((execution) => execution.recoveredFromFailureClass) ?? null;
  const failedExecution =
    executions.find((execution) => execution.finalFailureClass) ?? null;
  const observedUsage = executions.reduce(
    (usage, execution) =>
      mergeUsage(usage, readAutomationExecutionObservedUsage(execution)),
    EMPTY_CAPTURED_USAGE
  );
  const distinctModelIds = (modelIds: Array<string | null | undefined>) => {
    const seen = new Set<string>();
    return modelIds.flatMap((modelId) => {
      const trimmed = modelId?.trim();
      if (!trimmed) return [];
      const normalized = trimmed.toLowerCase();
      if (seen.has(normalized)) return [];
      seen.add(normalized);
      return [trimmed];
    });
  };
  const requestedModelIds = distinctModelIds(
    executions.map((execution) => execution.requestedModelId)
  );
  const effectiveModelIds = distinctModelIds(
    executions.flatMap((execution) => execution.effectiveModelIds ?? [])
  );
  const gatewayModelAttempts = executions
    .flatMap((execution) => execution.gatewayModelAttempts ?? [])
    .slice(0, 50);
  const gatewayModelAttemptCount = executions.reduce(
    (total, execution) => total + (execution.gatewayModelAttemptCount ?? 0),
    0
  );
  const hasFallbackRouting = executions.some(
    (execution) => execution.fallbackUsed !== undefined
  );

  return {
    phase:
      executions.length === 1
        ? executions[0].phase
        : executions.map((execution) => execution.phase).join(","),
    attempts: executions.reduce(
      (total, execution) => total + execution.attempts,
      0
    ),
    retryCount: executions.reduce(
      (total, execution) => total + execution.retryCount,
      0
    ),
    retried: executions.some((execution) => execution.retried),
    effectiveTimeoutMs: Math.max(
      ...executions.map((execution) => execution.effectiveTimeoutMs)
    ),
    recoveredFromFailureClass:
      recoveredExecution?.recoveredFromFailureClass ?? null,
    recoveredFromMessage: recoveredExecution?.recoveredFromMessage ?? null,
    finalFailureClass: failedExecution?.finalFailureClass ?? null,
    finalFailureMessage: failedExecution?.finalFailureMessage ?? null,
    finalFailureStatusCode: failedExecution?.finalFailureStatusCode ?? null,
    ...(requestedModelIds.length === 1
      ? { requestedModelId: requestedModelIds[0] }
      : {}),
    ...(gatewayModelAttempts.length > 0 ? { gatewayModelAttempts } : {}),
    ...(gatewayModelAttemptCount > 0 ? { gatewayModelAttemptCount } : {}),
    ...(effectiveModelIds.length > 0 ? { effectiveModelIds } : {}),
    ...(hasFallbackRouting
      ? {
          fallbackUsed: executions.some(
            (execution) => execution.fallbackUsed === true
          ),
        }
      : {}),
    ...(hasCapturedUsage(observedUsage)
      ? {
          observedInputTokens: observedUsage.inputTokens,
          observedOutputTokens: observedUsage.outputTokens,
          observedUsage,
        }
      : {}),
  };
}

export function buildAutomationExecutionMetadataFields(
  execution: AutomationModelExecutionMetadata | null | undefined
) {
  if (!execution) {
    return {};
  }

  return {
    model_execution_phase: execution.phase,
    model_attempts: execution.attempts,
    model_retry_attempted: execution.retried,
    model_retry_count: execution.retryCount,
    model_effective_timeout_ms: execution.effectiveTimeoutMs,
    model_recovered_from_failure_class: execution.recoveredFromFailureClass,
    model_recovered_from_message: execution.recoveredFromMessage,
    model_failure_class: execution.finalFailureClass,
    model_failure_message: execution.finalFailureMessage,
    model_failure_status_code: execution.finalFailureStatusCode,
    ...(execution.requestedModelId
      ? { model_requested: execution.requestedModelId }
      : {}),
    ...(execution.effectiveModelIds
      ? { model_effective_ids: execution.effectiveModelIds }
      : {}),
    ...(typeof execution.fallbackUsed === "boolean"
      ? { model_fallback_used: execution.fallbackUsed }
      : {}),
    ...(typeof execution.gatewayModelAttemptCount === "number"
      ? { gateway_model_attempt_count: execution.gatewayModelAttemptCount }
      : {}),
  };
}

export function buildAutomationJobModelFailureDiagnostics(
  execution: AutomationModelExecutionMetadata | null | undefined
): AutomationJobModelFailureDiagnostics | null {
  if (!execution?.finalFailureClass) {
    return null;
  }

  return {
    phase: execution.phase,
    failureClass: execution.finalFailureClass,
    statusCode: execution.finalFailureStatusCode,
    attempts: execution.attempts,
    retryCount: execution.retryCount,
  };
}

export function readAutomationExecutionObservedUsage(
  execution: AutomationModelExecutionMetadata | null | undefined
): CapturedUsage {
  return fillUsageGaps(execution?.observedUsage ?? EMPTY_CAPTURED_USAGE, {
    ...EMPTY_CAPTURED_USAGE,
    inputTokens:
      typeof execution?.observedInputTokens === "number"
        ? execution.observedInputTokens
        : null,
    outputTokens:
      typeof execution?.observedOutputTokens === "number"
        ? execution.observedOutputTokens
        : null,
  });
}

export function resolveAutomationAiCallUsage(input: {
  inputTokens: number | null;
  outputTokens: number | null;
  execution: AutomationModelExecutionMetadata | null | undefined;
}): CapturedUsage {
  const observedUsage = readAutomationExecutionObservedUsage(input.execution);

  return fillUsageGaps(
    {
      ...EMPTY_CAPTURED_USAGE,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    },
    observedUsage
  );
}

export function buildAutomationRuntimeMetadataFields(
  runtime: JobRunRuntimeDetails | null | undefined
) {
  if (!runtime) {
    return {};
  }

  return {
    runtime_provider: runtime.provider,
    runtime_run_id: runtime.runId,
  };
}

export function resolveJobRunRuntimeDetails(input: {
  runtime_provider?: BackgroundRuntimeProvider | null;
  runtime_run_id?: string | null;
  workflow_run_id?: string | null;
}): JobRunRuntimeDetails {
  return {
    provider:
      input.runtime_provider ?? (input.workflow_run_id ? "workflow" : null),
    runId: input.runtime_run_id ?? input.workflow_run_id ?? null,
  };
}

export function normalizeAutomationAgentResult(result: {
  text: string;
  totalUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
  } | null;
  execution?: AutomationModelExecutionMetadata | null;
  steps: Array<{
    text?: string;
    usage?: {
      inputTokens?: number | null;
      outputTokens?: number | null;
    } | null;
    toolCalls?: Array<{ toolName: string; input: unknown }>;
    toolResults?: unknown[];
  }>;
}): AutomationAgentResult {
  const lastStep = result.steps.at(-1);

  return {
    text: result.text ?? lastStep?.text ?? "",
    steps: result.steps.map((step) => ({
      toolCalls: (step.toolCalls || []).map((toolCall) => ({
        toolName: toolCall.toolName,
        input: toolCall.input,
      })),
      toolResults: step.toolResults,
    })),
    usage: result.totalUsage
      ? {
          inputTokens: result.totalUsage.inputTokens ?? null,
          outputTokens: result.totalUsage.outputTokens ?? null,
        }
      : result.steps.length === 0
        ? null
        : {
            inputTokens: sumNullableNumbers(
              result.steps.map((step) => step.usage?.inputTokens)
            ),
            outputTokens: sumNullableNumbers(
              result.steps.map((step) => step.usage?.outputTokens)
            ),
          },
    execution: result.execution ?? null,
  };
}

export function extractToolCalls(result: {
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input: unknown }>;
    toolResults?: unknown[];
  }>;
}) {
  return result.steps.flatMap((step) =>
    (step.toolCalls || []).map((toolCall, index) => {
      const input = sanitizeToolPayload(toolCall.input);
      const output = sanitizeToolPayload(step.toolResults?.[index]);

      return {
        name: toolCall.toolName,
        input,
        output,
        input_preview: previewTelemetryValue(input),
        output_preview: previewTelemetryValue(output),
      };
    })
  );
}

export function mergeAutomationAgentResults(
  results: AutomationAgentResult[]
): AutomationAgentResult {
  return {
    text: results
      .map((result) => result.text)
      .filter(Boolean)
      .join("\n\n")
      .trim(),
    steps: results.flatMap((result) => result.steps),
    usage: {
      inputTokens: sumNullableNumbers(
        results.map((result) => result.usage?.inputTokens)
      ),
      outputTokens: sumNullableNumbers(
        results.map((result) => result.usage?.outputTokens)
      ),
    },
    execution: mergeAutomationExecutionMetadata(results),
  };
}

export function resolveAutomationAiCallModel(
  configuredModelId: string,
  execution:
    | Pick<AutomationModelExecutionMetadata, "effectiveModelIds">
    | null
    | undefined
) {
  const effectiveModelIds = execution?.effectiveModelIds ?? [];
  const seen = new Set<string>();
  const distinctEffectiveModelIds = effectiveModelIds.flatMap((modelId) => {
    const trimmed = modelId.trim();
    if (!trimmed) return [];
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    return [trimmed];
  });

  // A single effective model can be priced and labeled accurately. When a
  // tool loop spans multiple effective models, keep the configured model on
  // the aggregate row and retain the full routing detail in execution metadata;
  // generation-ID reconciliation remains the source of truth for billed cost.
  return distinctEffectiveModelIds.length === 1
    ? distinctEffectiveModelIds[0]
    : configuredModelId;
}
