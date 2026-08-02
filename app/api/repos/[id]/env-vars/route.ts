import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  getPlatformSandboxCredentials,
  loadUserVercelCredentials,
} from "@/lib/sandbox/get-user-credentials";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  deleteVercelProjectEnvVar,
  listVercelProjectEnvVars,
  upsertVercelProjectEnvVar,
} from "@/lib/vercel/service";
import { resolveRepoEnvVarAccess } from "@/lib/vercel/target-resolution";
import type { VercelServiceError } from "@/lib/vercel/service";

type RouteContext = { params: Promise<{ id: string }> };

type RepoWithVercel = {
  id: string;
  user_id: string;
  env_sync_mode: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  sandbox_billing_mode_override: string | null;
  workspace: {
    sandbox_billing_mode: string | null;
    sandbox_vercel_team_id: string | null;
    sandbox_vercel_project_id: string | null;
  } | null;
};

type EnvVarRouteDeps = {
  requireUserId: typeof requireUserId;
  loadRepoWithVercel: (
    repoId: string,
    userId: string
  ) => Promise<RepoWithVercel | null>;
  loadUserVercelCredentials: typeof loadUserVercelCredentials;
  getPlatformSandboxCredentials: typeof getPlatformSandboxCredentials;
  listVercelProjectEnvVars: typeof listVercelProjectEnvVars;
  upsertVercelProjectEnvVar: typeof upsertVercelProjectEnvVar;
  deleteVercelProjectEnvVar: typeof deleteVercelProjectEnvVar;
};

type ResolvedEnvAccess =
  | {
      ok: true;
      authMode: "platform" | "personal";
      projectId: string;
      teamId: string | null;
      vercelToken: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
    };

const defaultDeps: EnvVarRouteDeps = {
  requireUserId,
  loadRepoWithVercel: async (repoId, userId) => {
    const { data } = await supabaseAdmin
      .from("repos")
      .select(
        "id, user_id, env_sync_mode, vercel_team_id, vercel_project_id, sandbox_billing_mode_override, workspace:workspaces(sandbox_billing_mode, sandbox_vercel_team_id, sandbox_vercel_project_id)"
      )
      .eq("id", repoId)
      .eq("user_id", userId)
      .single();
    return (data ?? null) as RepoWithVercel | null;
  },
  loadUserVercelCredentials,
  getPlatformSandboxCredentials,
  listVercelProjectEnvVars,
  upsertVercelProjectEnvVar,
  deleteVercelProjectEnvVar,
};

function mapServiceError(error: VercelServiceError) {
  switch (error.code) {
    case "AUTH_INVALID":
      return NextResponse.json(
        {
          error: "VERCEL_AUTH_INVALID",
          message:
            "Reconnect Vercel or refresh the configured platform credentials.",
        },
        { status: 401 }
      );
    case "PROJECT_NOT_FOUND":
      return NextResponse.json(
        {
          error: "VERCEL_PROJECT_NOT_FOUND",
          message: "The configured Vercel project no longer exists.",
        },
        { status: 404 }
      );
    case "PROJECT_FORBIDDEN":
      return NextResponse.json(
        {
          error: "VERCEL_PROJECT_FORBIDDEN",
          message: "The configured Vercel project is no longer accessible.",
        },
        { status: 403 }
      );
    case "TEAM_FORBIDDEN":
      return NextResponse.json(
        {
          error: "VERCEL_TEAM_FORBIDDEN",
          message: "The configured Vercel team is no longer accessible.",
        },
        { status: 403 }
      );
    case "RATE_LIMITED":
      return NextResponse.json(
        {
          error: "VERCEL_RATE_LIMITED",
          message: "Vercel rate limited the request.",
        },
        { status: 429 }
      );
    case "NOT_CONFIGURED":
      return NextResponse.json(
        {
          error: "PLATFORM_VERCEL_NOT_CONFIGURED",
          message: "Mogplex platform Vercel is not configured.",
        },
        { status: 400 }
      );
    default:
      return NextResponse.json(
        { error: "VERCEL_API_ERROR", message: "Vercel rejected the request." },
        { status: 502 }
      );
  }
}

async function resolveEnvAccess(
  repo: RepoWithVercel,
  userId: string,
  deps: EnvVarRouteDeps
): Promise<ResolvedEnvAccess> {
  // loadUserVercelCredentials internally fetches the user's Vercel OAuth token
  // and profile-stored defaults in a single Promise.all — calling getOAuthToken
  // separately here would double-fetch the token on every env-vars request.
  const accountVercelCreds = await deps
    .loadUserVercelCredentials(userId)
    .catch(() => null);
  const platform = deps.getPlatformSandboxCredentials();
  return resolveRepoEnvVarAccess({
    envSyncModeInput: repo.env_sync_mode,
    repoLinkedProjectId: repo.vercel_project_id,
    repoLinkedTeamId: repo.vercel_team_id,
    workspaceBillingModeInput: repo.workspace?.sandbox_billing_mode,
    repoBillingModeOverrideInput: repo.sandbox_billing_mode_override,
    workspaceLinkedProjectId: repo.workspace?.sandbox_vercel_project_id,
    workspaceLinkedTeamId: repo.workspace?.sandbox_vercel_team_id,
    accountLinkedProjectId: accountVercelCreds?.accountDefaultVercelProjectId,
    accountLinkedTeamId: accountVercelCreds?.accountDefaultVercelTeamId,
    personalVercelToken: accountVercelCreds?.userVercelToken ?? null,
    platformVercelToken: platform.vercelToken,
    platformVercelTeamId: platform.vercelTeamId,
    platformVercelProjectId: platform.vercelProjectId,
  });
}

async function loadAuthorizedRepo(
  ctx: RouteContext,
  deps: EnvVarRouteDeps
): Promise<
  | { ok: true; userId: string; repo: RepoWithVercel }
  | { ok: false; response: Response }
> {
  const userId = await deps.requireUserId();
  if (userId instanceof Response) {
    return { ok: false, response: userId };
  }

  const { id } = await ctx.params;
  const repo = await deps.loadRepoWithVercel(id, userId);
  if (!repo) {
    return {
      ok: false,
      response: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }),
    };
  }

  return {
    ok: true,
    userId,
    repo,
  };
}

export function createRepoEnvVarsGetHandler(
  overrides: Partial<EnvVarRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };

  return async function GET(_req: Request, ctx: RouteContext) {
    const loaded = await loadAuthorizedRepo(ctx, deps);
    if (!loaded.ok) return loaded.response;

    const access = await resolveEnvAccess(loaded.repo, loaded.userId, deps);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error, message: access.message },
        { status: access.status }
      );
    }

    const envResult = await deps.listVercelProjectEnvVars({
      authMode: access.authMode,
      vercelToken: access.vercelToken,
      projectId: access.projectId,
      teamId: access.teamId,
      decrypt: true,
    });

    if (!envResult.ok) {
      return mapServiceError(envResult.error);
    }

    const envVars = envResult.data.map((entry) => ({
      id: entry.id,
      key: entry.key,
      value: entry.value ?? "",
      target: entry.target || [],
      type: entry.type || "encrypted",
    }));

    return NextResponse.json(envVars);
  };
}

export function createRepoEnvVarsPostHandler(
  overrides: Partial<EnvVarRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };

  return async function POST(req: Request, ctx: RouteContext) {
    const loaded = await loadAuthorizedRepo(ctx, deps);
    if (!loaded.ok) return loaded.response;

    const access = await resolveEnvAccess(loaded.repo, loaded.userId, deps);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error, message: access.message },
        { status: access.status }
      );
    }

    const body = (await req.json()) as {
      key?: string;
      value?: string;
      target?: string[];
      type?: string;
    };
    if (!body.key?.trim()) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    const createResult = await deps.upsertVercelProjectEnvVar({
      authMode: access.authMode,
      vercelToken: access.vercelToken,
      projectId: access.projectId,
      teamId: access.teamId,
      key: body.key.trim(),
      value: body.value ?? "",
      target: body.target,
      type: body.type,
    });

    if (!createResult.ok) {
      return mapServiceError(createResult.error);
    }

    return NextResponse.json({
      id: createResult.data.id,
      key: createResult.data.key,
    });
  };
}

export function createRepoEnvVarsPatchHandler(
  overrides: Partial<EnvVarRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };

  return async function PATCH(req: Request, ctx: RouteContext) {
    const loaded = await loadAuthorizedRepo(ctx, deps);
    if (!loaded.ok) return loaded.response;

    const access = await resolveEnvAccess(loaded.repo, loaded.userId, deps);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error, message: access.message },
        { status: access.status }
      );
    }

    const body = (await req.json()) as {
      envId?: string;
      value?: string;
      target?: string[];
    };
    if (!body.envId) {
      return NextResponse.json({ error: "envId is required" }, { status: 400 });
    }

    const updateResult = await deps.upsertVercelProjectEnvVar({
      authMode: access.authMode,
      vercelToken: access.vercelToken,
      projectId: access.projectId,
      teamId: access.teamId,
      envId: body.envId,
      value: body.value ?? "",
      target: body.target,
    });

    if (!updateResult.ok) {
      return mapServiceError(updateResult.error);
    }

    return NextResponse.json({ ok: true });
  };
}

export function createRepoEnvVarsDeleteHandler(
  overrides: Partial<EnvVarRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };

  return async function DELETE(req: Request, ctx: RouteContext) {
    const loaded = await loadAuthorizedRepo(ctx, deps);
    if (!loaded.ok) return loaded.response;

    const access = await resolveEnvAccess(loaded.repo, loaded.userId, deps);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error, message: access.message },
        { status: access.status }
      );
    }

    const body = (await req.json()) as { envId?: string };
    if (!body.envId) {
      return NextResponse.json({ error: "envId is required" }, { status: 400 });
    }

    const deleteResult = await deps.deleteVercelProjectEnvVar({
      authMode: access.authMode,
      vercelToken: access.vercelToken,
      projectId: access.projectId,
      teamId: access.teamId,
      envId: body.envId,
    });

    if (!deleteResult.ok) {
      return mapServiceError(deleteResult.error);
    }

    return NextResponse.json({ ok: true });
  };
}

export const GET = createRepoEnvVarsGetHandler();
export const POST = createRepoEnvVarsPostHandler();
export const PATCH = createRepoEnvVarsPatchHandler();
export const DELETE = createRepoEnvVarsDeleteHandler();
