import { hasGithubAppConfig } from "@/lib/github-app";
import {
  hasGithubAppUserAuthConfig,
  hasGithubAppUserGrant,
} from "@/lib/github-app-user-auth";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";

const defaultDeps = {
  appConfigured: () => hasGithubAppConfig(),
  appUserAuthConfigured: () => hasGithubAppUserAuthConfig(),
  hasGrant: (userId: string, login: string) =>
    hasGithubAppUserGrant(userId, login),
};

/**
 * In an App deployment a personal repository is created with the user's own
 * App authorization, so the picker says when that step is still needed. A
 * deployment without the App's client credentials cannot create there at all,
 * so the personal account is not offered.
 */
export async function markPersonalAuthorization(
  userId: string,
  targets: GithubRepoOwnerTarget[],
  overrides: Partial<typeof defaultDeps> = {}
): Promise<GithubRepoOwnerTarget[]> {
  const deps = { ...defaultDeps, ...overrides };
  if (!deps.appConfigured()) return targets;
  if (!deps.appUserAuthConfigured())
    return targets.filter((target) => target.kind !== "personal");
  return Promise.all(
    targets.map(async (target) => {
      if (target.kind !== "personal") return target;
      const authorized = await deps
        .hasGrant(userId, target.login)
        .catch(() => false);
      return { ...target, authorization_required: !authorized };
    })
  );
}
