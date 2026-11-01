import {
  buildGithubRepoOwnerTargets,
  canCreateInGithubOrg,
  fetchGithubCurrentUserContext,
  fetchGithubUserOrgs,
  filterCreatableGithubOrgLogins,
} from "@/lib/github-owners";
import { loadUserGithubInstallations } from "@/app/api/github/_lib/user-installations";
import { supabaseAdmin } from "@/lib/supabase/admin";

type OwnerTargetOptions = {
  requireOwner?: boolean;
  onlyLogin?: string | null;
};

async function creatableOrgLoginsFor(
  userId: string,
  token: string,
  options: OwnerTargetOptions,
  personalLogin: string | null
) {
  // A personal-account create needs no organization reads at all.
  if (
    options.onlyLogin &&
    options.onlyLogin.toLowerCase() === personalLogin?.toLowerCase()
  )
    return [];
  // A create names one owner: check that org directly, so a GitHub failure
  // surfaces as one instead of reading as a refusal.
  if (options.onlyLogin) {
    const creatable = await canCreateInGithubOrg(token, options.onlyLogin, {
      requireOwner: options.requireOwner,
    });
    return creatable ? [options.onlyLogin] : [];
  }
  const orgLogins = await fetchGithubUserOrgs(token).catch((error) => {
    console.warn("[github-owners] organization membership unavailable", {
      userId,
      error,
    });
    return [] as string[];
  });
  return filterCreatableGithubOrgLogins(token, orgLogins, {
    requireOwner: options.requireOwner,
  });
}

/**
 * Owners the user may create a repository under, for the owner picker.
 * `requireOwner` (App deployments) keeps only orgs the user owns, because an
 * installation token does not apply the org's own member policy.
 */
export async function loadGithubRepoCreationOwnerTargets(
  userId: string,
  token: string,
  options: OwnerTargetOptions = {}
) {
  const [profileResult, installationsResult, currentUser] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("github_username")
      .eq("id", userId)
      .maybeSingle(),
    loadUserGithubInstallations(userId),
    fetchGithubCurrentUserContext(token).catch((error) => {
      console.warn("[github-owners] GitHub user context unavailable", {
        userId,
        error,
      });
      return { login: null, oauthScopes: null };
    }),
  ]);

  if (profileResult.error) {
    throw new Error(
      `Failed to load GitHub profile: ${profileResult.error.message}`
    );
  }
  if (installationsResult.error) {
    throw new Error(
      `Failed to load GitHub installations: ${installationsResult.error.message}`
    );
  }

  const githubUsername =
    currentUser.login || (profileResult.data?.github_username as string | null);
  const creatableOrgLogins = await creatableOrgLoginsFor(
    userId,
    token,
    options,
    githubUsername
  );
  const creatableOrgSet = new Set(
    creatableOrgLogins.map((login) => login.toLowerCase())
  );
  const targets = buildGithubRepoOwnerTargets({
    githubUsername,
    installations: installationsResult.data || [],
    orgLogins: creatableOrgLogins,
  }).filter(
    (target) =>
      target.kind === "personal" ||
      creatableOrgSet.has(target.login.toLowerCase())
  );
  return { targets, oauthScopes: currentUser.oauthScopes };
}
