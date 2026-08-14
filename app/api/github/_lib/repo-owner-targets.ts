import {
  buildGithubRepoOwnerTargets,
  fetchGithubCurrentUserLogin,
  fetchGithubUserOrgs,
  filterCreatableGithubOrgLogins,
} from "@/lib/github-owners";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function loadGithubRepoCreationOwnerTargets(
  userId: string,
  token: string
) {
  const [profileResult, installationsResult, currentLogin] = await Promise.all([
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
    fetchGithubCurrentUserLogin(token).catch(() => null),
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

  const orgLogins = await fetchGithubUserOrgs(token).catch((error) => {
    console.warn("[github-owners] organization membership unavailable", {
      userId,
      error,
    });
    return [] as string[];
  });
  const creatableOrgLogins = await filterCreatableGithubOrgLogins(
    token,
    orgLogins
  );
  const creatableOrgSet = new Set(
    creatableOrgLogins.map((login) => login.toLowerCase())
  );
  return buildGithubRepoOwnerTargets({
    githubUsername:
      currentLogin || (profileResult.data?.github_username as string | null),
    installations: installationsResult.data || [],
    orgLogins: creatableOrgLogins,
  }).filter(
    (target) =>
      target.kind === "personal" ||
      creatableOrgSet.has(target.login.toLowerCase())
  );
}
