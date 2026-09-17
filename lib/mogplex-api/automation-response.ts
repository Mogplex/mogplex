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
    const code =
      error.status === 404
        ? "NOT_FOUND"
        : error.status === 409
          ? "CONFLICT"
          : "BAD_REQUEST";
    return mogplexApiError(code, error.message, error.status);
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
