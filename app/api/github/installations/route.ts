import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGithubInstallation, hasGithubAppConfig } from "@/lib/github-app";
import { reconcileGithubInstallationsForUser } from "@/lib/github-installations";
import { getOAuthToken } from "@/lib/oauth-tokens";

type GithubInstallationRow = {
  id: string;
  installation_id: number;
  account_login: string | null;
  account_type: string | null;
  target_type: string | null;
};

type GithubInstallationRepoRow = {
  id: string;
  full_name: string;
  github_installation_id: string | number | null;
};

type GithubProfileRow = {
  github_username: string | null;
};

type GithubInstallationMetadataUpdate = {
  account_login: string | null;
  account_type: string | null;
  target_type: string | null;
  permissions: Record<string, string> | null;
};

type GithubInstallationsRouteDeps = {
  getCookies: typeof cookies;
  requireUserId: typeof requireUserId;
  hasGithubAppConfig: typeof hasGithubAppConfig;
  reconcileGithubInstallationsForUser: typeof reconcileGithubInstallationsForUser;
  getOAuthToken: typeof getOAuthToken;
  getGithubInstallation: typeof getGithubInstallation;
  loadInstallations: (userId: string) => Promise<{
    data: GithubInstallationRow[] | null;
    error: { message: string } | null;
  }>;
  loadRepos: (userId: string) => Promise<{
    data: GithubInstallationRepoRow[] | null;
    error: { message: string } | null;
  }>;
  loadProfile: (userId: string) => Promise<{
    data: GithubProfileRow | null;
    error: { message: string } | null;
  }>;
  updateInstallationMetadata: (
    rowId: string,
    updates: GithubInstallationMetadataUpdate
  ) => Promise<{ error: { message: string } | null }>;
};

function getInstallationScopeKind(installation: {
  target_type: string | null;
  account_type: string | null;
}) {
  const rawScope = installation.target_type || installation.account_type;
  if (!rawScope) return null;
  if (rawScope.toLowerCase().includes("org")) return "Org";
  if (rawScope.toLowerCase().includes("user")) return "User";
  return null;
}

function getInstallationScopeLabel(installation: {
  target_type: string | null;
  account_type: string | null;
}) {
  const scopeKind = getInstallationScopeKind(installation);
  if (scopeKind === "Org") return "Org";
  if (scopeKind === "User") return "User";

  return installation.target_type || installation.account_type || "Account";
}

function installationMetadataIncomplete(installation: GithubInstallationRow) {
  return (
    !installation.account_login?.trim() ||
    !installation.account_type?.trim() ||
    !installation.target_type?.trim()
  );
}

function getInstallationManageUrl(installation: {
  installation_id: number;
  account_login: string | null;
  target_type: string | null;
  account_type: string | null;
}) {
  const scopeKind = getInstallationScopeKind(installation);
  if (scopeKind === "Org" && installation.account_login) {
    return `https://github.com/organizations/${installation.account_login}/settings/installations/${installation.installation_id}`;
  }
  if (scopeKind === "User") {
    return `https://github.com/settings/installations/${installation.installation_id}`;
  }
  return null;
}

const defaultGithubInstallationsRouteDeps: GithubInstallationsRouteDeps = {
  getCookies: cookies,
  requireUserId,
  hasGithubAppConfig,
  reconcileGithubInstallationsForUser,
  getOAuthToken,
  getGithubInstallation,
  async loadInstallations(userId) {
    const { data, error } = await supabaseAdmin
      .from("github_installations")
      .select("id, installation_id, account_login, account_type, target_type")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    return {
      data: data as GithubInstallationRow[] | null,
      error: error ? { message: error.message } : null,
    };
  },
  async loadRepos(userId) {
    const { data, error } = await supabaseAdmin
      .from("repos")
      .select("id, full_name, github_installation_id")
      .eq("user_id", userId)
      .not("github_installation_id", "is", null)
      .order("full_name", { ascending: true });

    return {
      data: data as GithubInstallationRepoRow[] | null,
      error: error ? { message: error.message } : null,
    };
  },
  async loadProfile(userId) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("github_username")
      .eq("id", userId)
      .single();

    return {
      data: data as GithubProfileRow | null,
      error: error ? { message: error.message } : null,
    };
  },
  async updateInstallationMetadata(rowId, updates) {
    const { error } = await supabaseAdmin
      .from("github_installations")
      .update(updates)
      .eq("id", rowId);

    return {
      error: error ? { message: error.message } : null,
    };
  },
};

async function refreshInstallationMetadataIfNeeded(
  deps: GithubInstallationsRouteDeps,
  userId: string,
  installation: GithubInstallationRow
) {
  if (!installationMetadataIncomplete(installation)) {
    return installation;
  }

  try {
    const refreshed = await deps.getGithubInstallation(
      installation.installation_id
    );
    const updates: GithubInstallationMetadataUpdate = {
      account_login:
        refreshed.account?.login || installation.account_login || null,
      account_type:
        refreshed.account?.type || installation.account_type || null,
      target_type: refreshed.target_type || installation.target_type || null,
      permissions: refreshed.permissions || null,
    };
    const { error } = await deps.updateInstallationMetadata(
      installation.id,
      updates
    );
    if (error) {
      console.error("[github-installations-route] metadata update failed", {
        userId,
        installationId: installation.installation_id,
        error,
      });
    }

    return {
      ...installation,
      account_login: updates.account_login,
      account_type: updates.account_type,
      target_type: updates.target_type,
    };
  } catch (error) {
    console.error("[github-installations-route] metadata refresh failed", {
      userId,
      installationId: installation.installation_id,
      error,
    });
    return installation;
  }
}

export function createGithubInstallationsGetHandler(
  overrides: Partial<GithubInstallationsRouteDeps> = {}
) {
  const deps: GithubInstallationsRouteDeps = {
    ...defaultGithubInstallationsRouteDeps,
    ...overrides,
  };

  return async function GET() {
    const cookieStore = await deps.getCookies();
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let [
      { data: installations, error: installationsError },
      { data: repos, error: reposError },
      { data: profile, error: profileError },
    ] = await Promise.all([
      deps.loadInstallations(userId),
      deps.loadRepos(userId),
      deps.loadProfile(userId),
    ]);
    const githubToken = await deps.getOAuthToken(userId, "github");

    if (installationsError) {
      return NextResponse.json(
        { error: installationsError.message },
        { status: 500 }
      );
    }
    if (reposError) {
      return NextResponse.json({ error: reposError.message }, { status: 500 });
    }
    if (profileError) {
      return NextResponse.json(
        { error: profileError.message },
        { status: 500 }
      );
    }

    if (
      (installations?.length ?? 0) === 0 &&
      deps.hasGithubAppConfig() &&
      profile?.github_username
    ) {
      try {
        const result = await deps.reconcileGithubInstallationsForUser(
          userId,
          profile?.github_username || null,
          githubToken
        );
        if (result.discovered > 0) {
          cookieStore.delete("github_app_install_pending");
        }
        [
          { data: installations, error: installationsError },
          { data: repos, error: reposError },
        ] = await Promise.all([
          deps.loadInstallations(userId),
          deps.loadRepos(userId),
        ]);
      } catch (error) {
        console.error("[github-installations-route] reconciliation failed", {
          userId,
          error,
        });
      }
    }

    if (installationsError) {
      return NextResponse.json(
        { error: installationsError.message },
        { status: 500 }
      );
    }
    if (reposError) {
      return NextResponse.json({ error: reposError.message }, { status: 500 });
    }

    const hydratedInstallations = await Promise.all(
      (installations || []).map((installation) =>
        refreshInstallationMetadataIfNeeded(deps, userId, installation)
      )
    );

    const reposByInstallation = new Map<
      number,
      Array<{ id: string; full_name: string }>
    >();
    for (const repo of repos || []) {
      const installationId = Number(repo.github_installation_id);
      if (!Number.isFinite(installationId)) continue;
      const existing = reposByInstallation.get(installationId) || [];
      existing.push({ id: repo.id, full_name: repo.full_name });
      reposByInstallation.set(installationId, existing);
    }

    return NextResponse.json(
      hydratedInstallations.map((installation) => ({
        ...installation,
        repositories:
          reposByInstallation.get(Number(installation.installation_id)) || [],
        repository_count: (
          reposByInstallation.get(Number(installation.installation_id)) || []
        ).length,
        synced_repo_count: (
          reposByInstallation.get(Number(installation.installation_id)) || []
        ).length,
        scope_label: getInstallationScopeLabel(installation),
        manage_url: getInstallationManageUrl(installation),
      }))
    );
  };
}

export const GET = createGithubInstallationsGetHandler();
