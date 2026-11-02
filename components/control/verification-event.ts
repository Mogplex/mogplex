import type { VerificationEvent } from "@/lib/control/types";
import { repositoryVerificationSummarySchema } from "@/lib/agents/orchestrator/checks/receipt";
import { sanitizeAgentUserFacingError } from "@/lib/agents/user-facing-output";

export function verificationEvent(metadata: unknown): VerificationEvent | null {
  if (!metadata || typeof metadata !== "object") return null;
  const parsed = repositoryVerificationSummarySchema.safeParse(
    (metadata as Record<string, unknown>).repository_verification
  );
  if (!parsed.success) return null;
  const verification = parsed.data;
  if (verification.error)
    verification.error = sanitizeAgentUserFacingError(verification.error);
  verification.verified &&=
    !verification.required &&
    !verification.error &&
    verification.checks.every(
      (check) => check.status === "passed" && check.exitCode === 0
    );
  verification.checks = verification.checks.map((check) => ({
    ...check,
    reason: check.reason
      ? sanitizeAgentUserFacingError(check.reason)
      : undefined,
    stdout: check.stdout
      ? sanitizeAgentUserFacingError(check.stdout)
      : undefined,
    stderr: check.stderr
      ? sanitizeAgentUserFacingError(check.stderr)
      : undefined,
  }));
  const body = verification.verified
    ? "Workspace checks passed"
    : verification.checks.some((check) => check.status === "failed")
      ? "Workspace checks need attention"
      : verification.error
        ? "Workspace verification unconfirmed"
        : verification.checks.some((check) => check.status === "skipped")
          ? "Workspace checks limited by request"
          : verification.required
            ? "Workspace checks pending"
            : "Workspace checks unavailable";
  return {
    kind: "verification",
    label: "CHECKS",
    time: "now",
    body,
    verification,
  };
}
