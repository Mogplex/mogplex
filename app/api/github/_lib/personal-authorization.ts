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
 * App authorization and needs the App installed on that account, so the
 * picker says which step is still needed. A
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
      if (target.github_installation_id == null)
        return { ...target, installation_required: true };
      const authorized = await deps
        .hasGrant(userId, target.login)
        .catch((error) => {
          console.warn("[github-owners] App user grant lookup failed", {
            userId,
            login: target.login,
            error,
          });
          return false;
        });
      return { ...target, authorization_required: !authorized };
    })
  );
}
