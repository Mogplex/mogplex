import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Lightweight repo-ownership check for route handlers that already
 * have a userId from requireUserId() and just need to verify the
 * targeted repo belongs to the caller.
 *
 * Returns `true` when the row exists; `false` when missing. Throws
 * on unexpected DB errors so the caller can decide whether to log
 * and respond 500 vs ignore.
 *
 * Distinct from `getOwnedRepoWithGithubAccessToken` which loads the
 * repo + GitHub token + workspace — that's overkill (and triggers
 * extra queries) for routes that only need the boolean ownership
 * answer.
 */
export async function ensureOwnedRepo(
  repoId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("repos")
    .select("id")
    .eq("id", repoId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // Log the full Supabase error server-side so ops still has the
    // detail; throw a generic message so route handlers don't end up
    // surfacing column/constraint names through HTTP responses.
    console.error("[repo-auth] ensureOwnedRepo failed", {
      repoId,
      userId,
      error,
    });
    throw new Error("Failed to verify repo ownership");
  }

  return Boolean(data);
}
