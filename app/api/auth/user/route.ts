import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasGithubAppConfig } from "@/lib/github-app";
import { reconcileGithubInstallationsForUser } from "@/lib/github-installations";
import { deriveGithubState } from "@/lib/github-state";
import {
  getOAuthToken,
  hasOAuthToken,
  migrateLegacyOAuthTokensForUser,
} from "@/lib/oauth-tokens";
import { derivePlatformAccess } from "@/lib/platform-access";
import { getResolvedAuth } from "@/lib/auth";
import {
  deriveVercelCapability,
  resolveLinkedProjectState,
} from "@/lib/vercel/capabilities";
import { getPlatformVercelServiceState } from "@/lib/vercel/service";
import type { PlatformAccessProfile } from "@/lib/platform-access";

type AuthUserProfile = PlatformAccessProfile & {
  username: string | null;
  name: string | null;
  avatar_url: string | null;
  github_username: string | null;
};

export type AccountDefaultVercelProject = {
  projectId: string;
  teamId: string | null;
} | null;

type AuthUserRouteCookieStore = {
  get: (name: string) => { value?: string } | undefined;
  set: (name: string, value: string, options?: Record<string, unknown>) => void;
  delete: (name: string) => void;
};

type AuthUserRouteDeps = {
  getResolvedAuth: typeof getResolvedAuth;
  getCookies: () => Promise<AuthUserRouteCookieStore>;
  loadUserProfile: (userId: string) => Promise<AuthUserProfile | null>;
  loadInstallationCount: (userId: string) => Promise<number>;
  loadSyncedRepoCount: (userId: string) => Promise<number>;
  loadCoveredRepoCount: (userId: string) => Promise<number>;
  loadRepoLinkedProjectCount: (userId: string) => Promise<number>;
  loadWorkspaceLinkedProjectCount: (userId: string) => Promise<number>;
  loadAccountDefaultVercelProject: (
    userId: string
  ) => Promise<AccountDefaultVercelProject>;
  hasGithubAppConfig: typeof hasGithubAppConfig;
  reconcileGithubInstallationsForUser: typeof reconcileGithubInstallationsForUser;
  getOAuthToken: typeof getOAuthToken;
  hasOAuthToken: typeof hasOAuthToken;
  migrateLegacyOAuthTokensForUser: typeof migrateLegacyOAuthTokensForUser;
  getPlatformVercelServiceState: typeof getPlatformVercelServiceState;
};

async function loadUserProfile(userId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, email, username, name, avatar_url, github_username, allow_platform_ai, allow_platform_sandbox"
    )
    .eq("id", userId)
    .single();

  return (data ?? null) as AuthUserProfile | null;
}

async function loadInstallationCount(userId: string) {
  const { count } = await supabaseAdmin
    .from("github_installations")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  return count || 0;
}

async function loadSyncedRepoCount(userId: string) {
  const { count } = await supabaseAdmin
    .from("repos")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  return count || 0;
}

async function loadCoveredRepoCount(userId: string) {
  const { count } = await supabaseAdmin
    .from("repos")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("github_installation_id", "is", null);

  return count || 0;
}

async function loadRepoLinkedProjectCount(userId: string) {
  const { count } = await supabaseAdmin
    .from("repos")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("vercel_project_id", "is", null);

  return count || 0;
}

async function loadWorkspaceLinkedProjectCount(userId: string) {
  const { count } = await supabaseAdmin
    .from("workspaces")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("sandbox_vercel_project_id", "is", null);

  return count || 0;
}

async function loadAccountDefaultVercelProject(
  userId: string
): Promise<AccountDefaultVercelProject> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("default_vercel_project_id, default_vercel_team_id")
    .eq("id", userId)
    .single();

  const projectId = data?.default_vercel_project_id ?? null;
  if (!projectId) return null;

  return {
    projectId,
    teamId: data?.default_vercel_team_id ?? null,
  };
}

export function createAuthUserHandler(
  overrides: Partial<AuthUserRouteDeps> = {}
) {
  const deps: AuthUserRouteDeps = {
    getResolvedAuth,
    getCookies: cookies,
    loadUserProfile,
    loadInstallationCount,
    loadSyncedRepoCount,
    loadCoveredRepoCount,
    loadRepoLinkedProjectCount,
    loadWorkspaceLinkedProjectCount,
    loadAccountDefaultVercelProject,
    hasGithubAppConfig,
    reconcileGithubInstallationsForUser,
    getOAuthToken,
    hasOAuthToken,
    migrateLegacyOAuthTokensForUser,
    getPlatformVercelServiceState,
    ...overrides,
  };

  return async function GET() {
    const resolved = await deps.getResolvedAuth();
    const profileId = resolved?.profileId;
    const cookieStore = await deps.getCookies();
    const githubAppInstallPending =
      cookieStore.get("github_app_install_pending")?.value === "1";
    const githubAppAvailable = deps.hasGithubAppConfig();

    if (!profileId) {
      return NextResponse.json({ user: null });
    }

    const [
      user,
      initialInstallationCount,
      syncedRepoCount,
      initialCoveredRepoCount,
      repoLinkedProjectCount,
      workspaceLinkedProjectCount,
      accountDefaultVercelProject,
    ] = await Promise.all([
      deps.loadUserProfile(profileId),
      deps.loadInstallationCount(profileId),
      deps.loadSyncedRepoCount(profileId),
      deps.loadCoveredRepoCount(profileId),
      deps.loadRepoLinkedProjectCount(profileId),
      deps.loadWorkspaceLinkedProjectCount(profileId),
      deps.loadAccountDefaultVercelProject(profileId),
    ]);

    if (!user) {
      return NextResponse.json({ user: null });
    }

    const platformAccess = derivePlatformAccess(user);

    try {
      await deps.migrateLegacyOAuthTokensForUser(profileId);
    } catch (error) {
      console.error("[auth-user] legacy oauth token migration failed", {
        profileId,
        error,
      });
    }

    const [githubToken, personalVercelLinked] = await Promise.all([
      deps.getOAuthToken(profileId, "github"),
      deps.hasOAuthToken(profileId, "vercel"),
    ]);

    let installationCount = initialInstallationCount;
    let coveredRepoCount = initialCoveredRepoCount;
    const reconcileSkip =
      cookieStore.get("github_reconcile_skip")?.value === "1";
    if (
      installationCount === 0 &&
      coveredRepoCount === 0 &&
      githubAppAvailable &&
      !reconcileSkip
    ) {
      try {
        const result = await deps.reconcileGithubInstallationsForUser(
          profileId,
          user.github_username,
          githubToken
        );
        const [nextInstallationCount, nextCoveredRepoCount] = await Promise.all(
          [
            deps.loadInstallationCount(profileId),
            deps.loadCoveredRepoCount(profileId),
          ]
        );
        installationCount = Math.max(result.discovered, nextInstallationCount);
        coveredRepoCount = nextCoveredRepoCount;
        if (installationCount > 0) {
          cookieStore.delete("github_app_install_pending");
          cookieStore.delete("github_reconcile_skip");
        } else {
          // Avoid re-hitting GitHub API on every SWR refetch
          cookieStore.set("github_reconcile_skip", "1", {
            maxAge: 300,
            path: "/",
            httpOnly: true,
          });
        }
      } catch (error) {
        console.error("[auth-user] installation reconciliation failed", {
          profileId,
          error,
        });
      }
    }

    const githubState = deriveGithubState({
      hasGithubToken: Boolean(githubToken),
      githubAppAvailable,
      installationCount,
      syncedRepoCount,
      coveredRepoCount,
      installPending: githubAppInstallPending && installationCount === 0,
    });
    const platformVercel = deps.getPlatformVercelServiceState();
    const vercel = deriveVercelCapability({
      platformState: platformVercel.platformState,
      personalState: personalVercelLinked ? "linked" : "not_linked",
      linkedProjectState: resolveLinkedProjectState({
        repoLinkedProjectCount,
        workspaceLinkedProjectCount,
        accountDefaultProjectId: accountDefaultVercelProject?.projectId ?? null,
      }),
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
        github_username: user.github_username,
        ...githubState,
        platform_access: platformAccess,
        vercel,
        account_vercel_project_id:
          accountDefaultVercelProject?.projectId ?? null,
        account_vercel_team_id: accountDefaultVercelProject?.teamId ?? null,
      },
    });
  };
}

export const GET = createAuthUserHandler();
