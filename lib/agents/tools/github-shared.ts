const GITHUB_LOGIN_RE = /^[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?$/;
const GITHUB_REPO_NAME_RE = /^[A-Za-z\d._-]+$/;

export type NormalizedId = { value: string | null } | { error: string };

export function normalizeLogin(
  value: string | undefined,
  label: string
): NormalizedId {
  const trimmed = value?.trim();
  if (!trimmed) return { value: null };
  if (!GITHUB_LOGIN_RE.test(trimmed))
    return { error: `${label} must be a valid GitHub login.` };
  return { value: trimmed };
}

export function normalizeRepoName(value: string | undefined): NormalizedId {
  const trimmed = value?.trim();
  if (!trimmed) return { value: null };
  if (!GITHUB_REPO_NAME_RE.test(trimmed))
    return { error: "repo must be a valid GitHub repository name." };
  return { value: trimmed };
}

export async function findInstallationToken(input: {
  userId?: string | null;
  owner?: string | null;
}) {
  const { userId, owner } = input;
  if (!userId || !owner) return null;
  const [{ hasGithubAppConfig, createGithubInstallationAccessToken }, db] =
    await Promise.all([
      import("@/lib/github-app"),
      import("@/lib/supabase/admin"),
    ]);
  if (!hasGithubAppConfig()) return null;
  const { data, error } = await db.supabaseAdmin
    .from("github_installations")
    .select("installation_id, account_login")
    .eq("user_id", userId)
    .ilike("account_login", owner)
    .limit(1);
  if (error)
    throw new Error(`Failed to load GitHub installations: ${error.message}`);
  const installation = (
    (data ?? []) as Array<{
      installation_id?: number | null;
      account_login?: string | null;
    }>
  ).find(
    (row) =>
      row.installation_id &&
      row.account_login?.toLowerCase() === owner.toLowerCase()
  );
  if (!installation?.installation_id) return null;
  const { token } = await createGithubInstallationAccessToken(
    installation.installation_id
  );
  return token;
}
