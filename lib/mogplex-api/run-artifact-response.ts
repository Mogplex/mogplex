import { mogplexApiError } from "./response";
import { RunArtifactError } from "./run-artifacts";

const ARTIFACT_ERROR_CODES = {
  400: "BAD_REQUEST",
  404: "NOT_FOUND",
  409: "CONFLICT",
  502: "SERVICE_UNAVAILABLE",
} as const;

/**
 * The API response for a failed artifact read. A RunArtifactError carries a
 * message safe to return; anything else is logged by class only and becomes
 * a generic 500.
 */
export function runArtifactErrorResponse(
  error: unknown,
  logContext: Record<string, string>
) {
  if (error instanceof RunArtifactError) {
    return mogplexApiError(
      ARTIFACT_ERROR_CODES[error.status],
      error.message,
      error.status
    );
  }
  console.error("[mogplex-api/artifact] Could not read artifact", {
    ...logContext,
    errorType: error instanceof Error ? error.constructor.name : "UnknownError",
  });
  return mogplexApiError("INTERNAL_ERROR", "Could not read artifact", 500);
}
