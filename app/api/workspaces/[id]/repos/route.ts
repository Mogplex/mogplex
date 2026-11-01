import { parseJsonBody } from "@/lib/api/parse-json-body";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  createGithubRepo,
  extractGithubApiErrorMessage,
  GithubRepoCreateError,
} from "@/lib/github-create";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";
import {
  getGithubRepoCreationUserToken,
  resolveGithubRepoCreateCredential,
} from "@/lib/github-repo-create-credential";
import { upsertGithubReposForUser } from "@/lib/github-sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadGithubRepoCreationOwnerTargets } from "@/app/api/github/_lib/repo-owner-targets";
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
  getGithubToken: (userId: string) => Promise<string | null>;
  loadOwnerTargets: (
    userId: string,
    token: string
  ) => Promise<GithubRepoOwnerTarget[]>;
  resolveCreateCredential: typeof resolveGithubRepoCreateCredential;
  createGithubRepo: typeof createGithubRepo;
  upsertGithubReposForUser: typeof upsertGithubReposForUser;
  loadWorkspaceRepoByGithubId: (
    scope: ProductResourceScope,
    workspaceId: string,
    githubId: number
  ) => Promise<Record<string, unknown> | null>;
};

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
    getGithubToken: (userId) => getGithubRepoCreationUserToken(userId),
    loadOwnerTargets: async (userId, token) =>
      (await loadGithubRepoCreationOwnerTargets(userId, token)).targets,
    resolveCreateCredential: resolveGithubRepoCreateCredential,
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

    const jsonBody = await parseJsonBody(req);
    if (!jsonBody.ok) return jsonBody.response;
    const body = jsonBody.body;
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

    const githubToken = await deps.getGithubToken(userId).catch(() => null);
    if (!githubToken) {
      return NextResponse.json(
        { error: "Connect GitHub account first" },
        { status: 400 }
      );
    }

    // Revalidate live at the mutation boundary: an org is a target only
    // while this user may create repositories in it.
    let targets: GithubRepoOwnerTarget[];
    try {
      targets = await deps.loadOwnerTargets(userId, githubToken);
    } catch (error) {
      console.error("[workspace-repo-create] owner lookup failed", {
        userId,
        error,
      });
      return NextResponse.json(
        { error: "GitHub accounts unavailable" },
        { status: 502 }
      );
    }
    const ownerTarget = targets.find((target) =>
      ownerLogin
        ? target.login.toLowerCase() === ownerLogin.toLowerCase()
        : target.kind === "personal"
    );
    if (!ownerTarget) {
      return NextResponse.json(
        { error: "Selected GitHub account is unavailable" },
        { status: 400 }
      );
    }

    try {
      const credential = await deps.resolveCreateCredential(
        ownerTarget,
        githubToken
      );
      if (!credential.ok) {
        return NextResponse.json(
          { error: credential.error, code: credential.code },
          { status: credential.status }
        );
      }
      const createdRepo = await deps.createGithubRepo(credential.token, {
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
