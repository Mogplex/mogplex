export const BACKGROUND_RUNTIME_PROVIDERS = ["workflow", "trigger"] as const;

export type BackgroundRuntimeProvider =
  (typeof BACKGROUND_RUNTIME_PROVIDERS)[number];

export function getAutomationRuntimeProvider(): BackgroundRuntimeProvider {
  return "trigger";
}

export function getRepoSnapshotRuntimeProvider(): BackgroundRuntimeProvider {
  return "trigger";
}

/**
 * Whether this process can trigger Trigger.dev tasks. The SDK authenticates
 * with a secret key or access token alone; the project ref is baked into the
 * deployment. Deployed workers receive the credential from the platform, not
 * from the application's own environment, so requiring an app-level project
 * ref here would wrongly refuse tasks that trigger other tasks.
 */
export function isTriggerRuntimeConfigured() {
  return (
    hasValue(process.env.TRIGGER_SECRET_KEY) ||
    hasValue(process.env.TRIGGER_ACCESS_TOKEN)
  );
}

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}
