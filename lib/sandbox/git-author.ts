import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOAuthToken } from "@/lib/oauth-tokens";

const FALLBACK_AGENT_NAME = "mogplex-agent[bot]";
const FALLBACK_AGENT_EMAIL = "mogplex-agent[bot]@users.noreply.github.com";

export type SandboxGitAuthor = {
  name: string;
  email: string;
};

export const FALLBACK_SANDBOX_GIT_AUTHOR: SandboxGitAuthor = {
  name: FALLBACK_AGENT_NAME,
  email: FALLBACK_AGENT_EMAIL,
};

/**
 * Resolve the git author identity to use for sandbox commits made on
 * behalf of `userId`. Vercel preview deploys are gated on the commit
 * author email matching a GitHub account that's a member of the Vercel
 * team — so we author as the acting user using their canonical GitHub
 * noreply email `<id>+<login>@users.noreply.github.com`.
 *
 * Falls back to a bot identity if the user's GitHub linkage is missing
 * or can't be backfilled. Always succeeds; never throws.
 */
export async function resolveSandboxGitAuthor(
  userId: string
): Promise<SandboxGitAuthor> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("github_username, github_user_id, name")
    .eq("id", userId)
    .maybeSingle();

  const login = profile?.github_username?.trim() || null;
  let userIdNumeric =
    typeof profile?.github_user_id === "number" ? profile.github_user_id : null;

  if (login && userIdNumeric === null) {
    userIdNumeric = await backfillGithubUserId(userId, login);
  }

  if (!login || userIdNumeric === null) {
    return FALLBACK_SANDBOX_GIT_AUTHOR;
  }

  return {
    name: profile?.name?.trim() || login,
    email: `${userIdNumeric}+${login}@users.noreply.github.com`,
  };
}

async function backfillGithubUserId(
  userId: string,
  login: string
): Promise<number | null> {
  const token = await getOAuthToken(userId, "github").catch(() => null);

  try {
    const res = await fetch(
      token
        ? "https://api.github.com/user"
        : `https://api.github.com/users/${encodeURIComponent(login)}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: "application/vnd.github+json",
        },
      }
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: unknown; login?: unknown };
    if (typeof body.id !== "number") return null;
    if (typeof body.login === "string" && body.login !== login) return null;

    await supabaseAdmin
      .from("profiles")
      .update({ github_user_id: body.id })
      .eq("id", userId);
    return body.id;
  } catch {
    return null;
  }
}
