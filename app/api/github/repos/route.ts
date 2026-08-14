import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  syncGithubReposForUser,
  upsertGithubReposForUser,
} from "@/lib/github-sync";
import { getOAuthToken } from "@/lib/oauth-tokens";
import { requireUserId } from "@/lib/auth";
import {
  createGithubRepo,
  extractGithubApiErrorMessage,
  fetchGithubRepo,
  GithubRepoCreateError,
  isRecoverableGithubRepoCreateConflict,
} from "@/lib/github-create";
import { loadGithubRepoCreationOwnerTargets } from "@/app/api/github/_lib/repo-owner-targets";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";
import { validateGithubRepoName } from "@/lib/github-repo-name";
import { REPO_SELECT_WITH_WORKSPACE } from "@/lib/repos";
import {
  resolveActiveTeamCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import {
  applyResourceOwnerScope,
  resolveProductResourceScope,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";

export async function GET(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const scopeResolution = await resolveProductResourceScope({
    request,
    userId,
    requiredCapability: TEAM_RESOURCE_WRITE_CAPABILITY,
  });
  if (!scopeResolution.ok) {
    return NextResponse.json(
      { error: scopeResolution.error },
      { status: scopeResolution.status }
    );
  }

  const githubToken = await getOAuthToken(userId, "github");

  try {
    const repos = await syncGithubReposForUser(userId, githubToken, {
      productTeamId: scopeResolution.scope.productTeamId,
    });
    const { count: installationCount } = await supabaseAdmin
      .from("github_installations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (repos.length === 0 && !githubToken && !installationCount) {
      return NextResponse.json(
        { error: "NO_GITHUB_CONNECTION" },
        { status: 400 }
      );
    }
    return NextResponse.json(repos);
  } catch (error) {
    console.error("GitHub repo sync failed", error);
    return NextResponse.json({ error: "GITHUB_SYNC_ERROR" }, { status: 500 });
  }
}

type GithubRepoPostRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
  getGithubToken: typeof getOAuthToken;
  loadOwnerTargets: (
    userId: string,
    token: string
  ) => Promise<GithubRepoOwnerTarget[]>;
  createGithubRepo: typeof createGithubRepo;
  fetchGithubRepo: typeof fetchGithubRepo;
  upsertGithubReposForUser: typeof upsertGithubReposForUser;
  loadRepoByGithubId: (
    scope: ProductResourceScope,
    githubId: number
  ) => Promise<Record<string, unknown> | null>;
};

async function loadRepoByGithubId(
  scope: ProductResourceScope,
  githubId: number
) {
  let query = supabaseAdmin
    .from("repos")
    .select(REPO_SELECT_WITH_WORKSPACE)
    .eq("github_id", githubId)
    .is("root_directory", null);
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Failed to load created repo: ${error.message}`);
  }
  return data as Record<string, unknown> | null;
}

export function createGithubRepoPostHandler(
  overrides: Partial<GithubRepoPostRouteDeps> = {}
) {
  const deps: GithubRepoPostRouteDeps = {
    requireUserId,
    resolveActiveTeamCapabilities,
    getGithubToken: getOAuthToken,
    loadOwnerTargets: async (userId, token) =>
      (await loadGithubRepoCreationOwnerTargets(userId, token)).targets,
    createGithubRepo,
    fetchGithubRepo,
    upsertGithubReposForUser,
    loadRepoByGithubId,
    ...overrides,
  };

  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const scopeResolution = await resolveProductResourceScope({
      request,
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

    let body: { owner_login?: unknown; name?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const nameValidation = validateGithubRepoName(body.name);
    if (!nameValidation.ok) {
      return NextResponse.json(
        { error: nameValidation.message },
        { status: 400 }
      );
    }
    const ownerLogin =
      typeof body.owner_login === "string" ? body.owner_login.trim() : "";

    const token = await deps.getGithubToken(userId, "github").catch(() => null);
    if (!token) {
      return NextResponse.json(
        { error: "Connect GitHub account first" },
        { status: 400 }
      );
    }

    let ownerTargets: GithubRepoOwnerTarget[];
    try {
      ownerTargets = await deps.loadOwnerTargets(userId, token);
    } catch (error) {
      console.error("[github-repo-create] owner lookup failed", {
        userId,
        error,
      });
      return NextResponse.json(
        { error: "GitHub accounts unavailable" },
        { status: 502 }
      );
    }
    const ownerTarget = ownerTargets.find(
      (target) => target.login.toLowerCase() === ownerLogin.toLowerCase()
    );
    if (!ownerTarget) {
      return NextResponse.json(
        { error: "Selected GitHub account is unavailable" },
        { status: 400 }
      );
    }

    try {
      let createdRepo: Awaited<ReturnType<typeof createGithubRepo>>;
      try {
        createdRepo = await deps.createGithubRepo(token, {
          owner: ownerTarget.kind === "personal" ? null : ownerTarget.login,
          name: nameValidation.name,
          visibility: "private",
        });
      } catch (error) {
        if (!(error instanceof GithubRepoCreateError) || error.status !== 422) {
          throw error;
        }
        const existingRepo = await deps
          .fetchGithubRepo(token, ownerTarget.login, nameValidation.name)
          .catch((lookupError) => {
            console.warn("[github-repo-create] conflict lookup failed", {
              userId,
              owner: ownerTarget.login,
              name: nameValidation.name,
              error: lookupError,
            });
            return null;
          });
        if (
          !existingRepo ||
          !isRecoverableGithubRepoCreateConflict(existingRepo)
        ) {
          throw error;
        }
        createdRepo = existingRepo;
      }
      await deps.upsertGithubReposForUser(userId, [createdRepo], {
        githubInstallationId: ownerTarget.github_installation_id,
        productTeamId: scope.productTeamId,
      });

      const repo = await deps.loadRepoByGithubId(scope, createdRepo.id);
      if (!repo) {
        return NextResponse.json(
          { error: "Created repository was not imported" },
          { status: 500 }
        );
      }
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

      console.error("[github-repo-create] unexpected failure", {
        userId,
        owner: ownerTarget.login,
        name: nameValidation.name,
        error,
      });
      return NextResponse.json(
        { error: "Failed to create repository" },
        { status: 500 }
      );
    }
  };
}

export const POST = createGithubRepoPostHandler();
