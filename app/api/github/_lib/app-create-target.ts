import {
  fetchGithubCurrentUserContext,
  type GithubRepoOwnerTarget,
} from "@/lib/github-owners";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The single owner an App-deployment create names, without listing every org.
 * The credential resolver checks ownership live for that org, so a GitHub
 * failure here propagates instead of reading as a permission denial. A null
 * `ownerLogin` selects the user's personal account.
 */
export async function loadGithubAppCreateTarget(
  userId: string,
  token: string,
  ownerLogin: string | null
): Promise<{
  target: GithubRepoOwnerTarget | null;
  oauthScopes: string[] | null;
}> {
  const [currentUser, installations] = await Promise.all([
    fetchGithubCurrentUserContext(token),
    supabaseAdmin
      .from("github_installations")
      .select("installation_id, account_login")
      .eq("user_id", userId)
      // After a reinstall the newest row holds the live installation id.
      .order("created_at", { ascending: false }),
  ]);
  if (installations.error) {
    throw new Error(
      `Failed to load GitHub installations: ${installations.error.message}`
    );
  }
  const login = ownerLogin ?? currentUser.login;
  if (!login) return { target: null, oauthScopes: currentUser.oauthScopes };

  const personal = currentUser.login?.toLowerCase() === login.toLowerCase();
  const installation = (installations.data ?? []).find(
    (row) =>
      typeof row.account_login === "string" &&
      row.account_login.toLowerCase() === login.toLowerCase()
  );
  const installationId = Number(installation?.installation_id);
  return {
    target: {
      login,
      kind: personal ? "personal" : "org",
      github_installation_id:
        Number.isSafeInteger(installationId) && installationId > 0
          ? installationId
          : null,
      scope_label: personal ? "Personal" : "Org",
      source: installation ? "installation" : "oauth",
    },
    oauthScopes: currentUser.oauthScopes,
  };
}
