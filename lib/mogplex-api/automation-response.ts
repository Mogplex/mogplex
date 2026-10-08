import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import { MogplexApiAutomationError } from "@/lib/mogplex-api/automations";
import { mogplexApiError } from "@/lib/mogplex-api/response";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
  MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
} from "@/lib/team-capabilities";

function automationErrorCode(error: MogplexApiAutomationError) {
  if (error.code === "AUTOMATION_NOT_INTEGRATION_ENABLED") {
    return "AUTOMATION_REQUIRED" as const;
  }
  if (error.code === "IDEMPOTENCY_CONFLICT")
    return "IDEMPOTENCY_CONFLICT" as const;
  switch (error.status) {
    case 403:
      return "FORBIDDEN" as const;
    case 404:
      return "NOT_FOUND" as const;
    case 409:
      return "CONFLICT" as const;
    default:
      return "BAD_REQUEST" as const;
  }
}

export function mogplexAutomationErrorResponse(
  error: unknown,
  fallbackMessage: string
) {
  if (isModelAllowlistUnavailableError(error)) {
    return mogplexApiError(
      "SERVICE_UNAVAILABLE",
      MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
      503,
      {
        headers: {
          "Retry-After": String(ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS),
        },
      }
    );
  }
  if (error instanceof MogplexApiAutomationError) {
    return mogplexApiError(
      automationErrorCode(error),
      error.message,
      error.status
    );
  }
  if (isFlowServiceError(error)) {
    const status = getFlowServiceErrorStatus(error);
    const code =
      status === 404
        ? "NOT_FOUND"
        : status >= 500
          ? "INTERNAL_ERROR"
          : "BAD_REQUEST";
    if (status >= 500) {
      console.error("[mogplex-api/automations] flow service failed", error);
    }
    return mogplexApiError(
      code,
      status >= 500 ? fallbackMessage : error.message,
      status
    );
  }
  console.error("[mogplex-api/automations] request failed", error);
  return mogplexApiError("INTERNAL_ERROR", fallbackMessage, 500);
}
