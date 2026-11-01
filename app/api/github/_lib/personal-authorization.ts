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
 * In an App deployment every create needs the App installed on the owner,
 * and a personal repository also needs the user's own App authorization, so
 * the picker says which step is still needed. A
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
  // Every App-deployment create works through an installation, so an owner
  // without one is offered the install step before a create is refused.
  const marked = targets.map((target) =>
    target.github_installation_id == null
      ? { ...target, installation_required: true }
      : target
  );
  if (!deps.appUserAuthConfigured())
    return marked.filter((target) => target.kind !== "personal");
  return Promise.all(
    marked.map(async (target) => {
      if (target.kind !== "personal" || target.installation_required)
        return target;
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
