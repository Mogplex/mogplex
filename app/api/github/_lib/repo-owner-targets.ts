import {
  buildGithubRepoOwnerTargets,
  fetchGithubCurrentUserContext,
  fetchGithubUserOrgs,
  filterCreatableGithubOrgLogins,
} from "@/lib/github-owners";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Owners the user may create a repository under, for the owner picker.
 * `requireOwner` (App deployments) keeps only orgs the user owns, because an
 * installation token does not apply the org's own member policy.
 */
export async function loadGithubRepoCreationOwnerTargets(
  userId: string,
  token: string,
  options: {
    requireOwner?: boolean;
    onlyLogin?: string | null;
    personalOnly?: boolean;
  } = {}
) {
  const [profileResult, installationsResult, currentUser] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("github_username")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("github_installations")
      .select("installation_id, account_login, account_type, target_type")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
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

  // A personal-account create needs no organization reads at all.
  const orgLogins = options.personalOnly
    ? []
    : await fetchGithubUserOrgs(token).catch((error) => {
        console.warn("[github-owners] organization membership unavailable", {
          userId,
          error,
        });
        return [] as string[];
      });
  // A create names one owner; only that org's permissions need reading.
  const onlyLogin = options.onlyLogin?.toLowerCase();
  const candidateOrgLogins = onlyLogin
    ? orgLogins.filter((login) => login.toLowerCase() === onlyLogin)
    : orgLogins;
  const creatableOrgLogins = await filterCreatableGithubOrgLogins(
    token,
    candidateOrgLogins,
    { requireOwner: options.requireOwner }
  );
  const creatableOrgSet = new Set(
    creatableOrgLogins.map((login) => login.toLowerCase())
  );
  const targets = buildGithubRepoOwnerTargets({
    githubUsername:
      currentUser.login ||
      (profileResult.data?.github_username as string | null),
    installations: installationsResult.data || [],
    orgLogins: creatableOrgLogins,
  }).filter(
    (target) =>
      target.kind === "personal" ||
      creatableOrgSet.has(target.login.toLowerCase())
  );
  return { targets, oauthScopes: currentUser.oauthScopes };
}
