export const BACKGROUND_RUNTIME_PROVIDERS = ["workflow", "trigger"] as const;

export type BackgroundRuntimeProvider =
  (typeof BACKGROUND_RUNTIME_PROVIDERS)[number];

export function getAutomationRuntimeProvider(): BackgroundRuntimeProvider {
  return "trigger";
}

export function getRepoSnapshotRuntimeProvider(): BackgroundRuntimeProvider {
  return "trigger";
}

export function getTriggerProjectRef() {
  const value = process.env.TRIGGER_PROJECT_REF;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function isTriggerRuntimeConfigured() {
  const secretKey = process.env.TRIGGER_SECRET_KEY;
  return Boolean(secretKey && getTriggerProjectRef());
}
