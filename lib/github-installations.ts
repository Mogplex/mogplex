import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  findGithubInstallationForAccount,
  hasGithubAppConfig,
  type GithubInstallation,
} from "@/lib/github-app";
import {
  fetchGithubIdentityLogin,
  verifyGithubInstallationMember,
} from "@/lib/github-installation-owner";
import { mapGithubRequests } from "@/lib/github-request-concurrency";
import { syncGithubInstallationReposForUser } from "@/lib/github-sync";

const defaultDeps = {
  db: supabaseAdmin,
  request: ((input, init) => fetch(input, init)) as typeof fetch,
  findInstallation: findGithubInstallationForAccount,
  verifyMember: verifyGithubInstallationMember,
  fetchLogin: fetchGithubIdentityLogin,
  syncRepos: syncGithubInstallationReposForUser,
};

type Deps = typeof defaultDeps;

const ORG_PAGE_SIZE = 100;

/** Every org the user belongs to, across all pages; a failure keeps what was read. */
async function listGithubOrgLogins(token: string, request: Deps["request"]) {
  const logins: string[] = [];
  try {
    for (let page = 1; ; page++) {
      const response = await request(
        `https://api.github.com/user/orgs?per_page=${ORG_PAGE_SIZE}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!response.ok) break;
      const orgs: unknown = await response.json();
      if (!Array.isArray(orgs)) break;
      for (const org of orgs) {
        const login = (org as { login?: unknown })?.login;
        if (typeof login === "string") logins.push(login);
      }
      if (orgs.length < ORG_PAGE_SIZE) break;
    }
  } catch {
    // The user's own account is still a candidate.
  }
  return logins;
}

/**
 * Attach the Mogplex App installations on the user's account and on orgs they
 * belong to. The App must already be installed on the account; this only
 * links installations the user is a verified member of.
 */
export async function reconcileGithubInstallationsForUser(
  userId: string,
  _githubUsername?: string | null,
  githubToken?: string | null,
  overrides: Partial<Deps> = {}
) {
  if (!hasGithubAppConfig()) return { discovered: 0 };
  const deps = { ...defaultDeps, ...overrides };
  const { data, error } = await deps.db
    .from("github_installations")
    .select("account_login")
    .eq("user_id", userId);
  if (error) throw new Error("Could not verify existing GitHub installations");

  // Membership is checked for the login the token reports now, never a stored
  // one that a rename may have handed to someone else.
  const login = await deps.fetchLogin(githubToken, deps.request);
  if (!login || !githubToken) return { discovered: 0 };

  const attached = new Set(
    ((data ?? []) as Array<{ account_login: string | null }>)
      .map((row) => row.account_login?.toLowerCase())
      .filter(Boolean)
  );
  const orgs = await listGithubOrgLogins(githubToken, deps.request);
  const candidates = [
    ...new Map(
      [login, ...orgs].map((account) => [account.toLowerCase(), account])
    ).values(),
  ].filter((account) => !attached.has(account.toLowerCase()));

  const found = await mapGithubRequests(candidates, async (account) => {
    try {
      const installation = await deps.findInstallation(account);
      if (!installation) return null;
      return (await deps.verifyMember(installation, login))
        ? installation
        : null;
    } catch (lookupError) {
      console.error("[github-installations] account lookup failed", {
        userId,
        account,
        error: lookupError,
      });
      return null;
    }
  });
  const installations = found.filter(
    (installation): installation is GithubInstallation => installation !== null
  );
  if (installations.length === 0) return { discovered: 0 };

  const now = new Date().toISOString();
  const { error: upsertError } = await deps.db
    .from("github_installations")
    .upsert(
      installations.map((installation) => ({
        user_id: userId,
        installation_id: installation.id,
        account_login: installation.account?.login || null,
        account_type: installation.account?.type || null,
        target_type: installation.target_type || null,
        permissions: installation.permissions || {},
        updated_at: now,
      })),
      { onConflict: "user_id,installation_id" }
    );
  if (upsertError) {
    throw new Error(
      `Failed to persist discovered installations: ${upsertError.message}`
    );
  }

  const { error: profileError } = await deps.db
    .from("profiles")
    .update({ github_auth_mode: "app" })
    .eq("id", userId);
  if (profileError) {
    console.error("[github-installations] failed to update profile auth mode", {
      userId,
      error: profileError,
    });
  }

  await Promise.all(
    installations.map((installation) =>
      deps.syncRepos(userId, installation.id).catch((syncError) => {
        console.error("[github-installations] repo sync failed", {
          userId,
          installationId: installation.id,
          error: syncError,
        });
      })
    )
  );

  return { discovered: installations.length };
}
