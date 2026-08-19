import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  AutomationGatewayProviderAttempt,
  AutomationModelExecutionMetadata,
} from "./automation-model-execution-types";

type OperatorBlackboxFallbackEventInput = {
  affectedUserId: string;
  jobRunId: string;
  repoId: string | null;
  modelCallStartedAt: string;
  execution: AutomationModelExecutionMetadata | null | undefined;
};

type OperatorBlackboxFallbackEventRow = {
  affected_user_id: string;
  job_run_id: string;
  repo_id: string | null;
  model_call_started_at: string;
  phase: string;
  requested_model_id: string | null;
  pinned_model_id: string | null;
  served_provider: string;
  fallback_providers: string[];
  blackbox_failure_count: number;
  blackbox_failure_status_codes: number[];
  blackbox_provider_timeout: boolean;
  gateway_model_attempt_count: number;
  generation_ids: string[];
};

function isProvider(
  attempt: AutomationGatewayProviderAttempt,
  provider: string
) {
  return attempt.provider.toLowerCase() === provider;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function readBlackboxFailures(execution: AutomationModelExecutionMetadata) {
  return (execution.gatewayModelAttempts ?? [])
    .flatMap((modelAttempt) => modelAttempt.providerAttempts ?? [])
    .filter((attempt) => isProvider(attempt, "blackbox") && !attempt.success);
}

function readFallbackProviders(execution: AutomationModelExecutionMetadata) {
  return uniqueStrings(
    (execution.gatewayModelAttempts ?? []).flatMap((modelAttempt) =>
      (modelAttempt.providerAttempts ?? []).flatMap((attempt) =>
        attempt.success && !isProvider(attempt, "blackbox")
          ? [attempt.provider]
          : []
      )
    )
  );
}

function readGenerationIds(execution: AutomationModelExecutionMetadata) {
  const observedUsage = execution.observedUsage;
  if (!observedUsage) return [];
  return uniqueStrings([
    ...observedUsage.generationIds,
    ...(observedUsage.generationId ? [observedUsage.generationId] : []),
  ]);
}

function readGatewayModelAttemptCount(
  execution: AutomationModelExecutionMetadata
) {
  return Math.max(
    execution.gatewayModelAttemptCount ?? 0,
    execution.gatewayModelAttempts?.length ?? 0
  );
}

export function buildOperatorBlackboxFallbackEvent(
  input: OperatorBlackboxFallbackEventInput
): OperatorBlackboxFallbackEventRow | null {
  const execution = input.execution;
  if (!execution) return null;

  const blackboxFailures = readBlackboxFailures(execution);
  const fallbackProviders = readFallbackProviders(execution);
  if (blackboxFailures.length === 0 || fallbackProviders.length === 0) {
    return null;
  }

  return {
    affected_user_id: input.affectedUserId,
    job_run_id: input.jobRunId,
    repo_id: input.repoId,
    model_call_started_at: input.modelCallStartedAt,
    phase: execution.phase,
    requested_model_id: execution.requestedModelId ?? null,
    pinned_model_id: execution.pinnedModelId ?? null,
    served_provider: fallbackProviders[0],
    fallback_providers: fallbackProviders,
    blackbox_failure_count: blackboxFailures.length,
    blackbox_failure_status_codes: blackboxFailures.flatMap((attempt) =>
      attempt.statusCode === null ? [] : [attempt.statusCode]
    ),
    blackbox_provider_timeout: blackboxFailures.some(
      (attempt) => attempt.providerTimeout
    ),
    gateway_model_attempt_count: readGatewayModelAttemptCount(execution),
    generation_ids: readGenerationIds(execution),
  };
}

export function stripOperatorOnlyProviderDetails(
  execution: AutomationModelExecutionMetadata
): AutomationModelExecutionMetadata;
export function stripOperatorOnlyProviderDetails(
  execution: null | undefined
): null;
export function stripOperatorOnlyProviderDetails(
  execution: AutomationModelExecutionMetadata | null | undefined
): AutomationModelExecutionMetadata | null;
export function stripOperatorOnlyProviderDetails(
  execution: AutomationModelExecutionMetadata | null | undefined
): AutomationModelExecutionMetadata | null {
  if (!execution) return null;
  if (!execution.gatewayModelAttempts) return execution;

  return {
    ...execution,
    gatewayModelAttempts: execution.gatewayModelAttempts.map((attempt) => ({
      canonicalSlug: attempt.canonicalSlug,
      modelId: attempt.modelId,
      success: attempt.success,
      providerAttemptCount: attempt.providerAttemptCount,
    })),
  };
}

export async function persistOperatorBlackboxFallbackEvent(
  input: OperatorBlackboxFallbackEventInput,
  client: SupabaseClient = supabaseAdmin
) {
  const event = buildOperatorBlackboxFallbackEvent(input);
  if (!event) return null;

  const { error } = await client
    .from("operator_ai_provider_fallback_events")
    .upsert(event, {
      onConflict: "job_run_id,phase,model_call_started_at",
      ignoreDuplicates: true,
    });
  return error?.message ?? null;
}
