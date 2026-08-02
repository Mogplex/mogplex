import { detectMissingEnvVarHint } from "@/lib/sandbox/env-var-hint";

export function getPreviewFileSelectionResetState(
  trackedSandboxId: string | null | undefined,
  nextSandboxId: string | null | undefined
) {
  const normalizedTrackedSandboxId = trackedSandboxId ?? null;
  const normalizedNextSandboxId = nextSandboxId ?? null;

  return {
    trackedSandboxId: normalizedNextSandboxId,
    shouldClearActiveFile:
      normalizedTrackedSandboxId !== normalizedNextSandboxId,
  };
}

export function resolvePreviewEnvVarHint(input: {
  lastBootError?: string | null;
  lastPreviewError?: string | null;
  devLog?: string | null;
  errorMessage?: string | null;
  launchLogs?: string | null;
}) {
  return (
    detectMissingEnvVarHint(input.lastBootError) ??
    detectMissingEnvVarHint(input.lastPreviewError) ??
    detectMissingEnvVarHint(input.devLog) ??
    detectMissingEnvVarHint(input.errorMessage) ??
    detectMissingEnvVarHint(input.launchLogs)
  );
}
