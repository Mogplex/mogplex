import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import { MogplexApiAutomationError } from "@/lib/mogplex-api/automations";
import { mogplexApiError } from "@/lib/mogplex-api/response";

export function mogplexAutomationErrorResponse(
  error: unknown,
  fallbackMessage: string
) {
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
