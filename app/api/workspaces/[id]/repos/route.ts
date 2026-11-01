import { parseJsonBody } from "@/lib/api/parse-json-body";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { createGithubRepo, fetchGithubRepo } from "@/lib/github-create";
import { createAndImportGithubRepo } from "@/app/api/github/_lib/create-repo-with-recovery";
import {
  defaultRepoCreateTargetDeps,
  resolveRepoCreateTarget,
  type RepoCreateTargetDeps,
} from "@/app/api/github/_lib/repo-create-target";
import { upsertGithubReposForUser } from "@/lib/github-sync";
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

type WorkspaceRepoRouteDeps = RepoCreateTargetDeps & {
  requireUserId: typeof requireUserId;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
  getWorkspaceForScope: (
    workspaceId: string,
    scope: ProductResourceScope,
    select: string
  ) => Promise<Record<string, unknown> | null>;
  createGithubRepo: typeof createGithubRepo;
  fetchGithubRepo: typeof fetchGithubRepo;
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
    ...defaultRepoCreateTargetDeps,
    createGithubRepo,
    fetchGithubRepo,
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

    // Like POST /api/github/repos, the owner is always named: a client that
    // lost its selection must not fall through to the personal account.
    if (!ownerLogin) {
      return NextResponse.json(
        { error: "Choose a GitHub account for the repository" },
        { status: 400 }
      );
    }
    const target = await resolveRepoCreateTarget(userId, ownerLogin, deps);
    if (!target.ok) return target.response;
    return createAndImportGithubRepo({
      deps,
      userId,
      target,
      repo: { name, description, visibility },
      importOptions: {
        workspaceId: workspace.id,
        productTeamId: scope.productTeamId,
      },
      loadImported: (githubId) =>
        deps.loadWorkspaceRepoByGithubId(scope, workspace.id, githubId),
      logScope: "workspace-repo-create",
    });
  };
}

export const POST = createWorkspaceRepoPostHandler();
