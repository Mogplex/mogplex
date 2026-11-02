import type { SandboxSetupIssue } from "@/lib/sandbox/events";

function isSetupPhase(value: unknown): value is SandboxSetupIssue["phase"] {
  return (
    value === "detect" ||
    value === "prerequisite" ||
    value === "install" ||
    value === "dev"
  );
}

/** Narrow a streamed setup issue; anything malformed is dropped. */
export function parseSetupIssue(value: unknown): SandboxSetupIssue | null {
  if (!value || typeof value !== "object") return null;
  const { phase, message, logTail, envVarHint } = value as Record<
    string,
    unknown
  >;
  if (!isSetupPhase(phase) || typeof message !== "string") return null;
  return {
    phase,
    message,
    logTail: typeof logTail === "string" ? logTail : "",
    envVarHint: typeof envVarHint === "string" ? envVarHint : null,
  };
}
