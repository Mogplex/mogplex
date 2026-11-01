import {
  buildGithubRepoOwnerTargets,
  fetchGithubCurrentUserContext,
  fetchGithubUserOrgs,
  filterCreatableGithubOrgLogins,
} from "@/lib/github-owners";
import { hasGithubAppConfig } from "@/lib/github-app";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Owners the user may create a repository under. `onlyLogin` limits the
 * per-org permission reads to the one org a create request names; the
 * owner picker omits it and lists every org.
 */
export async function loadGithubRepoCreationOwnerTargets(
  userId: string,
  token: string,
  options: { onlyLogin?: string | null } = {}
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
    fetchGithubCurrentUserContext(token).catch(() => ({
      login: null,
      oauthScopes: null,
    })),
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

  const memberOrgLogins = await fetchGithubUserOrgs(token).catch((error) => {
    console.warn("[github-owners] organization membership unavailable", {
      userId,
      error,
    });
    return [] as string[];
  });
  const onlyLogin = options.onlyLogin?.toLowerCase();
  const orgLogins = onlyLogin
    ? memberOrgLogins.filter((login) => login.toLowerCase() === onlyLogin)
    : memberOrgLogins;
  const creatableOrgLogins = await filterCreatableGithubOrgLogins(
    token,
    orgLogins,
    { requireOwner: hasGithubAppConfig() }
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
  return {
    targets,
    oauthScopes: currentUser.oauthScopes,
    // Orgs the user belongs to but may not create in, so a refusal can say so.
    deniedOrgLogins: orgLogins.filter(
      (login) => !creatableOrgSet.has(login.toLowerCase())
    ),
  };
}
