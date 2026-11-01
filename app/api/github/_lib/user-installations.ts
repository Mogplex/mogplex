import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The user's GitHub App installation rows, newest first: after a reinstall
 * the newest row holds the live installation id, so callers take the first
 * match per account.
 */
export function loadUserGithubInstallations(userId: string) {
  return supabaseAdmin
    .from("github_installations")
    .select("installation_id, account_login, account_type, target_type")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
}
