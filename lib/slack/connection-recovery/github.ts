import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { getGithubInstallation, hasGithubAppConfig } from "@/lib/github-app";
import {
  syncGithubInstallationReposForUser,
  syncGithubReposForUser,
} from "@/lib/github-sync";
import { getOAuthToken } from "@/lib/oauth-tokens";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ConnectionRecoveryTarget } from "./presentation";
import { findRecoveryRepository } from "./repository";

type GithubTarget = Extract<ConnectionRecoveryTarget, { provider: "github" }>;
type Installation = {
  installation_id: number;
  account_login: string | null;
  account_type: string | null;
};

const defaultDeps = {
  db: supabaseAdmin,
  getOAuthToken,
  getRepoToken: getGithubAccessTokenForRepo,
  getInstallation: getGithubInstallation,
  hasAppConfig: hasGithubAppConfig,
  syncInstallation: syncGithubInstallationReposForUser,
  syncOAuth: syncGithubReposForUser,
};

async function ownedInstallations(userId: string, db = supabaseAdmin) {
  const { data, error } = await db
    .from("github_installations")
    .select("installation_id, account_login, account_type")
    .eq("user_id", userId);
  if (error) throw new Error("Could not load GitHub installations");
  return (data ?? []) as Installation[];
}

export async function githubRecoveryAuthorizePath(
  userId: string,
  target: GithubTarget,
  next = "",
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const owner = target.repository?.split("/")[0].toLowerCase();
  const installation = (await ownedInstallations(userId, deps.db)).find(
    (item) => item.account_login?.toLowerCase() === owner
  );
  if (installation) {
    const prefix =
      installation.account_type === "Organization" && installation.account_login
        ? `https://github.com/organizations/${encodeURIComponent(installation.account_login)}/settings/installations`
        : "https://github.com/settings/installations";
    return `${prefix}/${installation.installation_id}`;
  }
  return `/api/auth/github?${deps.hasAppConfig() ? "" : "reauthorize=1&"}next=${next}`;
}

export async function checkGithubRecoveryAccess(
  userId: string,
  target: GithubTarget,
  options: {
    refresh?: boolean;
    productTeamId?: string | null;
    repoId?: string | null;
  } = {},
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const owner = target.repository?.split("/")[0].toLowerCase();
  const installations = (await ownedInstallations(userId, deps.db)).filter(
    (item) => !owner || item.account_login?.toLowerCase() === owner
  );
  // Refresh only installations already attached to this user. An App-wide
  // account lookup is not proof that this Slack user owns an installation.
  for (const installation of options.refresh === false ? [] : installations) {
    await deps.syncInstallation(userId, installation.installation_id, {
      productTeamId: options.productTeamId,
    });
  }
  if (installations.length === 0 && options.refresh !== false) {
    const oauth = await deps.getOAuthToken(userId, "github");
    if (oauth)
      await deps.syncOAuth(userId, oauth, {
        productTeamId: options.productTeamId,
      });
  }
  if (!target.repository) {
    // A saved installation or token is not evidence that its grant still works.
    if (installations.length > 0 && deps.hasAppConfig()) {
      await Promise.all(
        installations.map((item) => deps.getInstallation(item.installation_id))
      );
      return true;
    }
    const token = await deps.getOAuthToken(userId, "github");
    if (!token) return false;
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if ([401, 403, 404].includes(response.status)) return false;
    if (!response.ok)
      throw new Error("GitHub access check is temporarily unavailable");
    return true;
  }

  const repo = await findRecoveryRepository(
    {
      user_id: userId,
      target,
      product_team_id: options.productTeamId ?? null,
      repo_id: options.repoId ?? null,
    },
    deps.db
  );
  if (!repo || repo.is_hidden) return false;
  const token = await deps.getRepoToken(repo, userId);
  if (!token) return false;
  const response = await fetch(
    `https://api.github.com/repos/${target.repository}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }
  );
  if ([401, 403, 404].includes(response.status)) return false;
  if (!response.ok)
    throw new Error("GitHub access check is temporarily unavailable");
  if (target.access === "read") return true;
  if (repo.github_installation_id && deps.hasAppConfig()) {
    const installation = await deps.getInstallation(
      repo.github_installation_id
    );
    return (
      installation.permissions?.contents === "write" &&
      installation.permissions?.pull_requests === "write"
    );
  }
  const body = (await response.json()) as { permissions?: { push?: boolean } };
  return body.permissions?.push === true;
}
