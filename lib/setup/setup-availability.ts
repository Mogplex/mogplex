import { hasGithubAppConfig } from "@/lib/github-app";

export type GithubSetupAvailability =
  | { status: "available"; signingSecret: string }
  | { status: "disabled" }
  | { status: "already_configured" }
  | { status: "missing_signing_secret" };

/**
 * Whether `/admin/setup/github` may create a GitHub App.
 *
 * Setup only runs while no App is configured. Production deployments must
 * also opt in with `MOGPLEX_SETUP_ENABLED=1`, so the hosted service never
 * exposes it.
 */
export function getGithubSetupAvailability(
  env: NodeJS.ProcessEnv = process.env
): GithubSetupAvailability {
  const enabled =
    env.NODE_ENV !== "production" || env.MOGPLEX_SETUP_ENABLED?.trim() === "1";
  if (!enabled) return { status: "disabled" };
  if (hasGithubAppConfig(env)) return { status: "already_configured" };

  const signingSecret = env.BETTER_AUTH_SECRET?.trim();
  if (!signingSecret) return { status: "missing_signing_secret" };
  return { status: "available", signingSecret };
}
