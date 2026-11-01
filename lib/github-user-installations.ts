import { getGithubInstallation, GithubHttpError } from "@/lib/github-app";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type UserGithubInstallation = {
  installation_id: number;
  account_login: string | null;
  account_type: string | null;
};

const defaultDeps = {
  db: supabaseAdmin,
  getInstallation: getGithubInstallation,
};

/** Resolve only installations already attached to this user, without adding grants. */
export async function listUserGithubInstallations(
  userId: string,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<UserGithubInstallation[]> {
  const deps = { ...defaultDeps, ...overrides };
  const { data, error } = await deps.db
    .from("github_installations")
    .select("installation_id, account_login, account_type")
    .eq("user_id", userId);
  if (error)
    throw new Error(`Failed to load GitHub installations: ${error.message}`);

  const installations: UserGithubInstallation[] = [];
  for (const row of (data ?? []) as UserGithubInstallation[]) {
    if (!Number.isSafeInteger(row.installation_id) || row.installation_id <= 0)
      continue;
    if (row.account_login) {
      installations.push(row);
      continue;
    }
    // Historical rows can have an installation id but no account metadata.
    // Verify that same attached id; never discover an org-wide App grant and
    // attach it to an arbitrary user as a fallback for missing authorization.
    try {
      const current = await deps.getInstallation(row.installation_id);
      if (current.account?.login)
        installations.push({
          ...row,
          account_login: current.account.login,
          account_type: current.account.type ?? null,
        });
    } catch (error) {
      if (
        error instanceof GithubHttpError &&
        [401, 403, 404].includes(error.status)
      )
        continue;
      throw error;
    }
  }
  return installations;
}
