export const SANDBOX_READINESS_WAIT_HEADER = "x-mogplex-wait-for-readiness";

/** The `sandbox_id` a record carries until its VM exists. */
export const PENDING_SANDBOX_ID = "pending";

export function requestsSandboxReadinessWait(headers: Headers) {
  return headers.get(SANDBOX_READINESS_WAIT_HEADER) === "1";
}
