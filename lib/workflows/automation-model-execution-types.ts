import type { generateText } from "ai";
import type { CapturedUsage } from "@/lib/observability/usage";

export type GenerateTextRequest = Parameters<typeof generateText>[0];

export type AutomationWrappableLanguageModel = Extract<
  GenerateTextRequest["model"],
  { specificationVersion: "v3" }
>;

export type AutomationModelFailureClass =
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  // A Mogplex-side dependency needed to authorize the run was unreachable —
  // not the model provider, which is why this is not provider_unavailable:
  // "provider was unavailable" would send an operator to the wrong dashboard.
  | "dependency_unavailable"
  | "authentication"
  | "configuration"
  | "unknown";

export type AutomationModelFailureInfo = {
  classification: AutomationModelFailureClass;
  /**
   * Describes the *failure* — transient vs permanent — not a promise that
   * anything retries it. Read this before wiring a retry loop off it.
   *
   * Only the generate-level middleware acts on it, and only for errors thrown
   * from an already-resolved model. A resolution-time failure (notably
   * `dependency_unavailable`) never reaches that middleware, and
   * trigger/automation-job.ts aborts every model failure on purpose: by then
   * the run has published a GitHub check run and PR comment and written its
   * telemetry, so a re-run duplicates all of it on a real PR.
   *
   * Generic retry driven off this flag would silently reintroduce that
   * double-comment bug. Resolution-time retry belongs at the resolution call
   * site, ahead of those side effects — tracked in #766.
   */
  retryable: boolean;
  rawMessage: string;
  message: string;
  statusCode: number | null;
  errorName: string | null;
  errorCode: string | null;
};

export type AutomationGatewayModelAttempt = {
  canonicalSlug: string;
  modelId: string | null;
  success: boolean;
  providerAttemptCount: number | null;
};

export type AutomationModelExecutionMetadata = {
  phase: string;
  attempts: number;
  retryCount: number;
  retried: boolean;
  effectiveTimeoutMs: number;
  observedInputTokens?: number | null;
  observedOutputTokens?: number | null;
  observedUsage?: CapturedUsage | null;
  recoveredFromFailureClass: AutomationModelFailureClass | null;
  recoveredFromMessage: string | null;
  finalFailureClass: AutomationModelFailureClass | null;
  finalFailureMessage: string | null;
  finalFailureStatusCode: number | null;
  requestedModelId?: string;
  // The id the automation was pinned to, when a deprecated-model upgrade
  // substituted a successor before the request. Present only when a
  // substitution happened, so its absence means "ran on what was pinned".
  // Without it, an upgraded run is indistinguishable in ai_calls from one that
  // was always pinned to the successor — and this feature changes which model
  // bills, so support needs that evidence per run.
  pinnedModelId?: string;
  gatewayModelAttempts?: AutomationGatewayModelAttempt[];
  gatewayModelAttemptCount?: number;
  effectiveModelIds?: string[];
  fallbackUsed?: boolean;
};

export type AutomationGenerateRetryState = {
  retryCount: number;
  recoveredFromFailureClass: AutomationModelFailureClass | null;
  recoveredFromMessage: string | null;
};

export type AutomationGatewayRoutingState = {
  requestedModelId: string | null;
  pinnedModelId?: string | null;
  modelAttempts: AutomationGatewayModelAttempt[];
  modelAttemptCount: number;
  effectiveModelIds: string[];
};

export type AutomationGatewayRoutingMetadata = Pick<
  AutomationModelExecutionMetadata,
  | "requestedModelId"
  | "pinnedModelId"
  | "gatewayModelAttempts"
  | "gatewayModelAttemptCount"
  | "effectiveModelIds"
  | "fallbackUsed"
>;

export type AutomationErrorSignals = {
  rawMessage: string;
  combinedMessage: string;
  errorName: string | null;
  lowerName: string;
  errorCode: string | null;
  lowerCode: string;
  statusCode: number | null;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAutomationWrappableLanguageModel(
  model: GenerateTextRequest["model"]
): model is AutomationWrappableLanguageModel {
  return (
    isRecord(model) &&
    model.specificationVersion === "v3" &&
    typeof model.provider === "string" &&
    typeof model.modelId === "string" &&
    typeof model.doGenerate === "function" &&
    typeof model.doStream === "function"
  );
}
