import { supabaseAdmin } from "@/lib/supabase/admin";

/** The GitHub login linked to a Mogplex profile, or null when none is. */
export async function findProfileGithubLogin(
  profileId: string | null,
  logScope = "github-profile-login"
) {
  if (!profileId) return null;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("github_username")
    .eq("id", profileId)
    .maybeSingle();
  if (error) {
    console.warn(`[${logScope}] github username lookup failed`, {
      profileId,
      error,
    });
    return null;
  }
  const githubUsername = data?.github_username;
  return typeof githubUsername === "string" && githubUsername.trim()
    ? githubUsername.trim()
    : null;
}
