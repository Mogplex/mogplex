import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  createGithubRepo,
  extractGithubApiErrorMessage,
  GithubRepoCreateError,
} from "@/lib/github-create";
import {
  buildGithubRepoOwnerTargets,
  fetchGithubCurrentUserLogin,
  fetchGithubUserOrgs,
} from "@/lib/github-owners";
import { upsertGithubReposForUser } from "@/lib/github-sync";
import { getOAuthToken } from "@/lib/oauth-tokens";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getWorkspaceForScope,
  normalizeWorkspaceDescription,
  normalizeWorkspaceName,
} from "@/lib/workspaces";
import {
  resolveActiveTeamCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import {
  applyResourceOwnerScope,
  resolveProductResourceScope,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";

type WorkspaceRepoRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
  getWorkspaceForScope: (
    workspaceId: string,
    scope: ProductResourceScope,
    select: string
  ) => Promise<Record<string, unknown> | null>;
  getGithubToken: typeof getOAuthToken;
  loadGithubProfile: (
    userId: string
  ) => Promise<{ github_username: string | null }>;
  loadGithubInstallations: (userId: string) => Promise<
    Array<{
      installation_id: number;
      account_login: string | null;
      account_type: string | null;
      target_type: string | null;
    }>
  >;
  fetchGithubCurrentUserLogin: typeof fetchGithubCurrentUserLogin;
  fetchGithubUserOrgs: typeof fetchGithubUserOrgs;
  createGithubRepo: typeof createGithubRepo;
  upsertGithubReposForUser: typeof upsertGithubReposForUser;
  loadWorkspaceRepoByGithubId: (
    scope: ProductResourceScope,
    workspaceId: string,
    githubId: number
  ) => Promise<Record<string, unknown> | null>;
};

async function loadGithubProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("github_username")
    .eq("id", userId)
    .single();

  if (error) {
    throw new Error(`Failed to load GitHub profile: ${error.message}`);
  }

  return data;
}

async function loadGithubInstallations(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("github_installations")
    .select("installation_id, account_login, account_type, target_type")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load GitHub installations: ${error.message}`);
  }

  return data || [];
}

async function loadWorkspaceRepoByGithubId(
  scope: ProductResourceScope,
  workspaceId: string,
  githubId: number
) {
  let query = supabaseAdmin
    .from("repos")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("github_id", githubId)
    .is("root_directory", null);
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Failed to load created repo: ${error.message}`);
  }

  return data;
}

function normalizeRepoName(value: unknown) {
  const trimmed = normalizeWorkspaceName(value);
  if (!trimmed || trimmed.includes("/")) return "";
  return trimmed;
}

function normalizeOwnerLogin(value: unknown) {
  const trimmed = normalizeWorkspaceName(value);
  return trimmed || null;
}

function normalizeVisibility(value: unknown) {
  return value === "public" ? "public" : "private";
}

export function createWorkspaceRepoPostHandler(
  overrides: Partial<WorkspaceRepoRouteDeps> = {}
) {
  const deps: WorkspaceRepoRouteDeps = {
    requireUserId,
    resolveActiveTeamCapabilities,
    getWorkspaceForScope: (workspaceId, scope, select) =>
      getWorkspaceForScope(workspaceId, scope, select),
    getGithubToken: getOAuthToken,
    loadGithubProfile,
    loadGithubInstallations,
    fetchGithubCurrentUserLogin,
    fetchGithubUserOrgs,
    createGithubRepo,
    upsertGithubReposForUser,
    loadWorkspaceRepoByGithubId,
    ...overrides,
  };

  return async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const { id } = await params;

    const scopeResolution = await resolveProductResourceScope({
      request: req,
      userId,
      requiredCapability: TEAM_RESOURCE_WRITE_CAPABILITY,
      resolveActiveTeamCapabilities: deps.resolveActiveTeamCapabilities,
    });
    if (!scopeResolution.ok) {
      return NextResponse.json(
        { error: scopeResolution.error },
        { status: scopeResolution.status }
      );
    }
    const { scope } = scopeResolution;

    const workspace = (await deps.getWorkspaceForScope(
      id,
      scope,
      "id, name"
    )) as { id: string; name: string } | null;
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const name = normalizeRepoName(body.name);
    const description = normalizeWorkspaceDescription(body.description);
    const ownerLogin = normalizeOwnerLogin(body.owner_login);
    const visibility = normalizeVisibility(body.visibility);
    if (!name) {
      return NextResponse.json(
        { error: "Repository name is required" },
        { status: 400 }
      );
    }

    const githubToken = await deps
      .getGithubToken(userId, "github")
      .catch(() => null);
    if (!githubToken) {
      return NextResponse.json(
        { error: "Connect GitHub account first" },
        { status: 400 }
      );
    }

    const [profile, installations] = await Promise.all([
      deps.loadGithubProfile(userId),
      deps.loadGithubInstallations(userId),
    ]);

    const githubUsername =
      profile.github_username ||
      (await deps.fetchGithubCurrentUserLogin(githubToken));
    if (!githubUsername) {
      return NextResponse.json(
        { error: "GitHub account details unavailable" },
        { status: 400 }
      );
    }

    const orgLogins = await deps
      .fetchGithubUserOrgs(githubToken)
      .catch((error) => {
        console.error("[workspace-repo-create] failed to load GitHub orgs", {
          userId,
          error,
        });
        return [] as string[];
      });
    const targets = buildGithubRepoOwnerTargets({
      githubUsername,
      installations,
      orgLogins,
    });

    const ownerTarget = targets.find(
      (target) =>
        target.login.toLowerCase() ===
        (ownerLogin || githubUsername).toLowerCase()
    );
    if (!ownerTarget) {
      return NextResponse.json(
        { error: "Selected GitHub account is unavailable" },
        { status: 400 }
      );
    }

    try {
      const createdRepo = await deps.createGithubRepo(githubToken, {
        owner: ownerTarget.kind === "personal" ? null : ownerTarget.login,
        name,
        description,
        visibility,
      });

      await deps.upsertGithubReposForUser(userId, [createdRepo], {
        githubInstallationId: ownerTarget.github_installation_id,
        workspaceId: workspace.id,
        productTeamId: scope.productTeamId,
      });

      const repo = await deps.loadWorkspaceRepoByGithubId(
        scope,
        workspace.id,
        createdRepo.id
      );
      return NextResponse.json(repo);
    } catch (error) {
      if (error instanceof GithubRepoCreateError) {
        const message =
          extractGithubApiErrorMessage(error.body) ||
          "GitHub repo creation failed";
        const status =
          error.status === 422
            ? 409
            : error.status === 401 || error.status === 403
              ? 403
              : 502;
        return NextResponse.json({ error: message }, { status });
      }

      console.error("[workspace-repo-create] unexpected failure", {
        userId,
        workspaceId: workspace.id,
        error,
      });
      return NextResponse.json(
        { error: (error as Error).message || "Failed to create repository" },
        { status: 500 }
      );
    }
  };
}

export const POST = createWorkspaceRepoPostHandler();
