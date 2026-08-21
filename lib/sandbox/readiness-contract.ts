export const SANDBOX_READINESS_WAIT_HEADER = "x-mogplex-wait-for-readiness";

export function requestsSandboxReadinessWait(headers: Headers) {
  return headers.get(SANDBOX_READINESS_WAIT_HEADER) === "1";
}
