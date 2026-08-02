import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  normalizeRepoSettings,
  normalizeRepoSettingsPatch,
} from "@/lib/repo-settings";
import { requireUserId } from "@/lib/auth";
import { hasGithubAppConfig } from "@/lib/github-app";
import { filterVisibleGithubRepos } from "@/lib/github-sync";
import { deriveRepoGithubCoverage } from "@/lib/github-state";
import { REPO_SELECT_WITH_WORKSPACE } from "@/lib/repos";
import {
  ensureDefaultWorkspaceForUser,
  getWorkspaceForScope,
} from "@/lib/workspaces";
import {
  buildUnknownVercelLinkState,
  shouldResetRepoVercelLinkState,
} from "@/lib/vercel/reconciliation";
import {
  resolveActiveTeamCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import {
  applyResourceOwnerScope,
  buildResourceOwnershipInsert,
  resolveProductResourceScope,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";

type LoadReposOptions = {
  singleId?: string | null;
  showHidden?: boolean;
};

type RepoRow = {
  id: string;
  github_id?: number | null;
  github_installation_id?: number | null;
  full_name?: string | null;
  is_favorite?: boolean | null;
  is_hidden?: boolean | null;
  [key: string]: unknown;
};

type DbResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

type ReposRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
  loadRepos: (
    scope: ProductResourceScope,
    options: LoadReposOptions
  ) => Promise<DbResult<RepoRow[]>>;
  countGithubInstallations: (userId: string) => Promise<number>;
  insertRepo: (payload: Record<string, unknown>) => Promise<DbResult<RepoRow>>;
  updateRepo: (
    id: string,
    scope: ProductResourceScope,
    updates: Record<string, unknown>
  ) => Promise<DbResult<RepoRow>>;
  deleteRepo: (
    id: string,
    scope: ProductResourceScope
  ) => Promise<{ error: { message: string } | null }>;
  getWorkspaceForScope: typeof getWorkspaceForScope;
  ensureDefaultWorkspaceForUser: typeof ensureDefaultWorkspaceForUser;
  hasGithubAppConfig: typeof hasGithubAppConfig;
};

async function defaultLoadRepos(
  scope: ProductResourceScope,
  options: LoadReposOptions
): Promise<DbResult<RepoRow[]>> {
  let query = supabaseAdmin.from("repos").select(REPO_SELECT_WITH_WORKSPACE);
  query = applyResourceOwnerScope(query, scope);
  if (options.singleId) {
    query = query.eq("id", options.singleId);
  } else if (!options.showHidden) {
    query = query.or("is_hidden.is.null,is_hidden.eq.false");
  }
  const { data, error } = await query
    .order("is_favorite", { ascending: false })
    .order("full_name", { ascending: true });

  return {
    data: (data ?? []) as RepoRow[],
    error: error ? { code: error.code, message: error.message } : null,
  };
}

async function defaultCountGithubInstallations(userId: string) {
  const { count } = await supabaseAdmin
    .from("github_installations")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  return count || 0;
}

async function defaultInsertRepo(
  payload: Record<string, unknown>
): Promise<DbResult<RepoRow>> {
  const { data, error } = await supabaseAdmin
    .from("repos")
    .insert(payload)
    .select(REPO_SELECT_WITH_WORKSPACE)
    .single();
  return {
    data: (data as RepoRow | null) ?? null,
    error: error ? { code: error.code, message: error.message } : null,
  };
}

async function defaultUpdateRepo(
  id: string,
  scope: ProductResourceScope,
  updates: Record<string, unknown>
): Promise<DbResult<RepoRow>> {
  let query = supabaseAdmin.from("repos").update(updates).eq("id", id);
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query
    .select(REPO_SELECT_WITH_WORKSPACE)
    .single();
  return {
    data: (data as RepoRow | null) ?? null,
    error: error ? { code: error.code, message: error.message } : null,
  };
}

async function defaultDeleteRepo(id: string, scope: ProductResourceScope) {
  let query = supabaseAdmin.from("repos").delete().eq("id", id);
  query = applyResourceOwnerScope(query, scope);
  const { error } = await query;
  return { error: error ? { message: error.message } : null };
}

function buildDeps(overrides: Partial<ReposRouteDeps>): ReposRouteDeps {
  return {
    requireUserId,
    resolveActiveTeamCapabilities,
    loadRepos: defaultLoadRepos,
    countGithubInstallations: defaultCountGithubInstallations,
    insertRepo: defaultInsertRepo,
    updateRepo: defaultUpdateRepo,
    deleteRepo: defaultDeleteRepo,
    getWorkspaceForScope,
    ensureDefaultWorkspaceForUser,
    hasGithubAppConfig,
    ...overrides,
  };
}

function withGithubCoverage<
  T extends { github_installation_id?: number | null },
>(repo: T, hasInstallations: boolean) {
  return {
    ...repo,
    ...deriveRepoGithubCoverage({
      hasInstallations,
      githubInstallationId: repo.github_installation_id,
    }),
  };
}

export function createReposGetHandler(overrides: Partial<ReposRouteDeps> = {}) {
  const deps = buildDeps(overrides);

  return async function GET(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const scopeResolution = await resolveProductResourceScope({
      request: req,
      userId,
      resolveActiveTeamCapabilities: deps.resolveActiveTeamCapabilities,
    });
    if (!scopeResolution.ok) {
      return NextResponse.json(
        { error: scopeResolution.error },
        { status: scopeResolution.status }
      );
    }
    const { scope } = scopeResolution;

    const { searchParams } = new URL(req.url);
    const showHidden = searchParams.get("show_hidden") === "true";
    const singleId = searchParams.get("id");

    const [reposResult, installationCount] = await Promise.all([
      deps.loadRepos(scope, { singleId, showHidden }),
      deps.countGithubInstallations(userId),
    ]);

    if (reposResult.error)
      return NextResponse.json(
        { error: reposResult.error.message },
        { status: 500 }
      );
    const repos = reposResult.data ?? [];

    const hasInstallations = installationCount > 0;
    const visibleRepos =
      !singleId && !showHidden
        ? filterVisibleGithubRepos(repos, {
            preferInstallationCoverage:
              hasInstallations && deps.hasGithubAppConfig(),
          })
        : repos;

    return NextResponse.json(
      visibleRepos.map((repo) => withGithubCoverage(repo, hasInstallations))
    );
  };
}

export function createReposPostHandler(
  overrides: Partial<ReposRouteDeps> = {}
) {
  const deps = buildDeps(overrides);

  return async function POST(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

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

    const body = await req.json();
    const settings = normalizeRepoSettings(body);
    const requestedWorkspaceId =
      typeof body.workspace_id === "string" && body.workspace_id.trim()
        ? body.workspace_id.trim()
        : null;
    const workspace = requestedWorkspaceId
      ? await deps.getWorkspaceForScope(requestedWorkspaceId, scope, "id")
      : await deps.ensureDefaultWorkspaceForUser(userId, {
          productTeamId: scope.productTeamId,
        });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const { data, error } = await deps.insertRepo({
      ...buildResourceOwnershipInsert(scope),
      workspace_id: workspace.id,
      github_id: body.github_id,
      full_name: body.full_name,
      owner: body.owner,
      name: body.name,
      ...settings,
      ...buildUnknownVercelLinkState(),
      is_favorite: Boolean(body.is_favorite),
    });

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json(
        { error: "Repo insert returned no row" },
        { status: 500 }
      );

    const installationCount = await deps.countGithubInstallations(userId);
    return NextResponse.json(withGithubCoverage(data, installationCount > 0));
  };
}

export function createReposPatchHandler(
  overrides: Partial<ReposRouteDeps> = {}
) {
  const deps = buildDeps(overrides);

  return async function PATCH(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

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

    const body = await req.json();
    if (!body.id)
      return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const updates: Record<string, unknown> = normalizeRepoSettingsPatch(body);
    if ("is_favorite" in body) {
      updates.is_favorite = Boolean(body.is_favorite);
    }
    if ("is_hidden" in body) {
      updates.is_hidden = Boolean(body.is_hidden);
    }
    if (shouldResetRepoVercelLinkState(body)) {
      Object.assign(updates, buildUnknownVercelLinkState());
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No repo updates provided" },
        { status: 400 }
      );
    }

    const { data, error } = await deps.updateRepo(body.id, scope, updates);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });

    const installationCount = await deps.countGithubInstallations(userId);
    return NextResponse.json(withGithubCoverage(data, installationCount > 0));
  };
}

export function createReposDeleteHandler(
  overrides: Partial<ReposRouteDeps> = {}
) {
  const deps = buildDeps(overrides);

  return async function DELETE(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

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

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const { error } = await deps.deleteRepo(id, scope);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  };
}

export const GET = createReposGetHandler();
export const POST = createReposPostHandler();
export const PATCH = createReposPatchHandler();
export const DELETE = createReposDeleteHandler();
