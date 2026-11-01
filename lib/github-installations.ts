import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasGithubAppConfig } from "@/lib/github-app";

/** Installation discovery is not consent to attach another account's grant. */
export async function reconcileGithubInstallationsForUser(
  userId: string,
  _githubUsername?: string | null,
  _githubToken?: string | null
) {
  if (!hasGithubAppConfig()) return { discovered: 0 };
  const { count, error } = await supabaseAdmin
    .from("github_installations")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error("Could not verify existing GitHub installations");
  return { discovered: count ?? 0 };
}
