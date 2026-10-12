/**
 * The hosted Mogplex Trigger.dev project. A public identifier, not a secret:
 * Trigger.dev's GitHub check displays it, and Trigger's GitHub integration
 * builds evaluate trigger.config.ts without our env vars, so the hosted
 * deploy depends on this default.
 */
export const HOSTED_TRIGGER_PROJECT_REF = "proj_ssjnkodxhnnukrwiymaf";

type EnvSource = Readonly<Record<string, string | undefined>>;

export type TriggerProjectRef = {
  ref: string;
  source: "env" | "hosted-default";
};

/** The configured project ref, or the hosted default for integration builds. */
export function resolveTriggerProjectRef(
  env: EnvSource = process.env
): TriggerProjectRef {
  const configured = env.TRIGGER_PROJECT_REF?.trim();
  return configured
    ? { ref: configured, source: "env" }
    : { ref: HOSTED_TRIGGER_PROJECT_REF, source: "hosted-default" };
}

/**
 * Throws when a human-run deploy or dev session would silently target the
 * hosted project because TRIGGER_PROJECT_REF is unset. An explicit
 * `--project-ref` / `-p` argument to the Trigger CLI also satisfies it.
 */
export function assertTriggerProjectRefConfigured(
  env: EnvSource,
  cliArgs: readonly string[]
): void {
  if (resolveTriggerProjectRef(env).source === "env") return;
  if (cliArgs.some((arg) => arg === "-p" || arg.startsWith("--project-ref"))) {
    return;
  }
  throw new Error(
    [
      "TRIGGER_PROJECT_REF is not set.",
      "Set it to your Trigger.dev project ref (proj_...) in .env.local or the environment.",
      `Maintainers deploying the hosted Mogplex project use TRIGGER_PROJECT_REF=${HOSTED_TRIGGER_PROJECT_REF}.`,
    ].join("\n")
  );
}
