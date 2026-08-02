import assert from "node:assert/strict";
import test from "node:test";

async function loadAuthUserRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/auth/user/route");
}

test("GET /api/auth/user returns null when there is no authenticated user", async () => {
  const { createAuthUserHandler } = await loadAuthUserRoute();

  const response = await createAuthUserHandler({
    getResolvedAuth: async () => undefined,
    getCookies: async () => ({
      get: () => undefined,
      set: () => {},
      delete: () => {},
    }),
  })();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: null });
});

test("GET /api/auth/user derives connected state from vault-backed OAuth storage", async () => {
  const { createAuthUserHandler } = await loadAuthUserRoute();
  const reconciliations: Array<{
    userId: string;
    username: string | null;
    token: string | null;
  }> = [];
  let migratedUserId: string | null = null;

  const response = await createAuthUserHandler({
    getResolvedAuth: async () => ({
      profileId: "user-123",
      authUserId: "auth-123",
      source: "supabase",
    }),
    getCookies: async () => ({
      get: (name: string) => {
        if (name === "github_app_install_pending") return { value: "1" };
        return undefined;
      },
      set: () => {},
      delete: () => {},
    }),
    loadUserProfile: async () => ({
      id: "user-123",
      email: "dev@example.com",
      username: "dev",
      name: "Dev User",
      avatar_url: "https://example.com/avatar.png",
      github_username: "octocat",
      allow_platform_ai: true,
      allow_platform_sandbox: true,
    }),
    loadInstallationCount: async () => 0,
    loadSyncedRepoCount: async () => 0,
    loadCoveredRepoCount: async () => 0,
    loadRepoLinkedProjectCount: async () => 0,
    loadWorkspaceLinkedProjectCount: async () => 0,
    loadAccountDefaultVercelProject: async () => null,
    hasGithubAppConfig: () => true,
    reconcileGithubInstallationsForUser: async (userId, username, token) => {
      reconciliations.push({
        userId,
        username: username ?? null,
        token: token ?? null,
      });
      return { discovered: 2 };
    },
    getOAuthToken: async (_userId, provider) =>
      provider === "github" ? "vault-github-token" : null,
    hasOAuthToken: async (_userId, provider) => provider === "vercel",
    migrateLegacyOAuthTokensForUser: async (userId) => {
      migratedUserId = userId;
    },
    getPlatformVercelServiceState: () => ({
      platformState: "ready",
      canUsePlatformOps: true,
    }),
  })();

  assert.equal(response.status, 200);
  assert.equal(migratedUserId, "user-123");
  assert.deepEqual(reconciliations, [
    {
      userId: "user-123",
      username: "octocat",
      token: "vault-github-token",
    },
  ]);

  assert.deepEqual(await response.json(), {
    user: {
      id: "user-123",
      email: "dev@example.com",
      username: "dev",
      name: "Dev User",
      avatar_url: "https://example.com/avatar.png",
      github_username: "octocat",
      github_state: "app_installed",
      github_connected: true,
      github_app_connected: true,
      github_connection_mode: "app",
      github_app_available: true,
      github_install_pending: false,
      github_installation_count: 2,
      github_synced_repo_count: 0,
      github_covered_repo_count: 0,
      github_status_label: "App installed",
      github_status_detail:
        "The GitHub App is installed, but no covered repositories are synced into Projects yet.",
      github_primary_action: {
        kind: "open_spaces",
        label: "Open Projects",
        href: "/projects/repositories",
      },
      platform_access: {
        allowPlatformAi: true,
        allowPlatformSandbox: true,
      },
      vercel: {
        platformState: "ready",
        personalState: "linked",
        linkedProjectState: "none",
        canUsePlatformOps: true,
        canLinkUserBillingProject: true,
        canUseUserBilling: false,
        statusLabel: "Platform ready",
        statusDetail:
          "Mogplex platform Vercel is ready. Personal Vercel is linked, but no billing project is selected yet.",
      },
      account_vercel_project_id: null,
      account_vercel_team_id: null,
    },
  });
});

test("GET /api/auth/user treats covered repos as app-connected even when installation rows are missing", async () => {
  const { createAuthUserHandler } = await loadAuthUserRoute();

  const response = await createAuthUserHandler({
    getResolvedAuth: async () => ({
      profileId: "user-123",
      authUserId: "auth-123",
      source: "supabase",
    }),
    getCookies: async () => ({
      get: () => undefined,
      set: () => {},
      delete: () => {},
    }),
    loadUserProfile: async () => ({
      id: "user-123",
      email: "dev@example.com",
      username: "dev",
      name: "Dev User",
      avatar_url: "https://example.com/avatar.png",
      github_username: "octocat",
      allow_platform_ai: false,
      allow_platform_sandbox: false,
    }),
    loadInstallationCount: async () => 0,
    loadSyncedRepoCount: async () => 27,
    loadCoveredRepoCount: async () => 12,
    loadRepoLinkedProjectCount: async () => 4,
    loadWorkspaceLinkedProjectCount: async () => 2,
    loadAccountDefaultVercelProject: async () => null,
    hasGithubAppConfig: () => true,
    reconcileGithubInstallationsForUser: async () => {
      throw new Error(
        "reconcileGithubInstallationsForUser should not be called when covered repos already exist"
      );
    },
    getOAuthToken: async () => null,
    hasOAuthToken: async () => false,
    migrateLegacyOAuthTokensForUser: async () => undefined,
    getPlatformVercelServiceState: () => ({
      platformState: "not_configured",
      canUsePlatformOps: false,
    }),
  })();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    user: {
      id: "user-123",
      email: "dev@example.com",
      username: "dev",
      name: "Dev User",
      avatar_url: "https://example.com/avatar.png",
      github_username: "octocat",
      github_state: "app_installed_with_synced_repos",
      github_connected: true,
      github_app_connected: true,
      github_connection_mode: "app",
      github_app_available: true,
      github_install_pending: false,
      github_installation_count: 0,
      github_synced_repo_count: 27,
      github_covered_repo_count: 12,
      github_status_label: "Ready",
      github_status_detail:
        "GitHub App coverage is active and synced repositories are available in Projects.",
      github_primary_action: null,
      platform_access: {
        allowPlatformAi: false,
        allowPlatformSandbox: false,
      },
      vercel: {
        platformState: "not_configured",
        personalState: "not_linked",
        linkedProjectState: "repo",
        canUsePlatformOps: false,
        canLinkUserBillingProject: false,
        canUseUserBilling: false,
        statusLabel: "Platform not configured",
        statusDetail:
          "Mogplex platform Vercel is not configured. Link Personal Vercel only if you want to bill sandboxes to your own Vercel project.",
      },
      account_vercel_project_id: null,
      account_vercel_team_id: null,
    },
  });
});
