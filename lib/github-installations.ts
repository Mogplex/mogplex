import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  findGithubInstallationForAccount,
  hasGithubAppConfig,
} from "@/lib/github-app";
import { syncGithubInstallationReposForUser } from "@/lib/github-sync";
import type { GithubInstallation } from "@/lib/github-app";

async function getCandidateAccounts(
  githubUsername: string | null | undefined,
  repos: Array<{ owner?: string | null; full_name?: string | null }>,
  githubToken?: string | null
) {
  const candidates = new Set<string>();

  if (githubUsername?.trim()) {
    candidates.add(githubUsername.trim());
  }

  for (const repo of repos) {
    const owner = repo.owner?.trim() || repo.full_name?.split("/")[0]?.trim();
    if (owner) {
      candidates.add(owner);
    }
    if (candidates.size >= 12) break;
  }

  // Fetch the user's GitHub org memberships so we can discover
  // installations on orgs that have no synced repos yet
  if (githubToken) {
    try {
      const res = await fetch("https://api.github.com/user/orgs?per_page=50", {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
        },
        cache: "no-store",
      });
      if (res.ok) {
        const orgs = (await res.json()) as Array<{ login?: string }>;
        for (const org of orgs) {
          if (org.login) candidates.add(org.login);
        }
      }
    } catch {
      // Non-fatal — we still have username + repo-based candidates
    }
  }

  return [...candidates];
}

function toInstallationRow(userId: string, installation: GithubInstallation) {
  return {
    user_id: userId,
    installation_id: installation.id,
    account_login: installation.account?.login || null,
    account_type: installation.account?.type || null,
    target_type: installation.target_type || null,
    permissions: installation.permissions || {},
    updated_at: new Date().toISOString(),
  };
}

export async function reconcileGithubInstallationsForUser(
  userId: string,
  githubUsername?: string | null,
  githubToken?: string | null
) {
  if (!hasGithubAppConfig()) return { discovered: 0 };

  const [{ count: existingCount }, { data: repos, error: reposError }] =
    await Promise.all([
      supabaseAdmin
        .from("github_installations")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
      supabaseAdmin
        .from("repos")
        .select("owner, full_name")
        .eq("user_id", userId)
        .order("full_name", { ascending: true })
        .limit(100),
    ]);

  if (existingCount) {
    return { discovered: existingCount };
  }

  if (reposError) {
    throw new Error(
      `Failed to load repos for installation reconciliation: ${reposError.message}`
    );
  }

  const candidates = await getCandidateAccounts(
    githubUsername,
    repos || [],
    githubToken
  );
  if (candidates.length === 0) {
    return { discovered: 0 };
  }

  const discoveredInstallations = new Map<number, GithubInstallation>();

  for (const account of candidates) {
    try {
      const installation = await findGithubInstallationForAccount(account);
      if (installation) {
        discoveredInstallations.set(installation.id, installation);
      }
    } catch (error) {
      console.error("[github-installations] account lookup failed", {
        userId,
        account,
        error,
      });
    }
  }

  const installations = [...discoveredInstallations.values()];
  if (installations.length === 0) {
    return { discovered: 0 };
  }

  const { error: upsertError } = await supabaseAdmin
    .from("github_installations")
    .upsert(
      installations.map((installation) =>
        toInstallationRow(userId, installation)
      ),
      {
        onConflict: "user_id,installation_id",
      }
    );

  if (upsertError) {
    throw new Error(
      `Failed to persist reconciled installations: ${upsertError.message}`
    );
  }

  const { error: profileError } = await supabaseAdmin
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
      syncGithubInstallationReposForUser(userId, installation.id).catch(
        (error) => {
          console.error(
            "[github-installations] repo sync failed after reconciliation",
            {
              userId,
              installationId: installation.id,
              error,
            }
          );
        }
      )
    )
  );

  return { discovered: installations.length };
}
