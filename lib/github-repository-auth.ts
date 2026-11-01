import { hasGithubAppConfig } from "@/lib/github-app";
import { getOAuthToken } from "@/lib/oauth-tokens";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** OAuth identity grants must not widen GitHub App repository installations. */
export async function isGithubOAuthRepositoryAccessAllowed(userId: string) {
  if (hasGithubAppConfig()) return false;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("github_auth_mode")
    .eq("id", userId)
    .maybeSingle();
  if (error)
    throw new Error("Could not verify GitHub repository authorization");
  // Missing App configuration must fail closed for an App-mode account too.
  // OAuth remains supported by deployments that only use the legacy OAuth flow.
  return Boolean(
    data && (data.github_auth_mode === "oauth" || data.github_auth_mode == null)
  );
}

export async function getGithubOAuthRepositoryToken(
  userId: string,
  provider: "github" = "github"
): Promise<string | null> {
  return (await isGithubOAuthRepositoryAccessAllowed(userId))
    ? getOAuthToken(userId, provider)
    : null;
}
