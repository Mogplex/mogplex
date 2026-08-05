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
import type { MogplexApiErrorCode } from "./response";
import type { VercelServiceError } from "@/lib/vercel/service";

// Env values never leave this module on reads. Agents connected over MCP set
// and delete env vars; they do not pull decrypted secrets into model context.
export type MogplexApiEnvVar = {
  id: string | null;
  key: string;
  target: string[];
  type: string;
  updatedAt: number | null;
};

export type MogplexApiEnvVarError = {
  code: MogplexApiErrorCode;
  message: string;
  status: number;
};

export type MogplexApiEnvVarResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: MogplexApiEnvVarError };

type EnvVarDeps = {
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

export const MOGPLEX_VERCEL_ENV_API_AVAILABLE = false;

function integrationRequired() {
  return envVarError(
    "SERVICE_UNAVAILABLE",
    "Vercel project environment variables require an API-capable Vercel integration and are not available.",
    501
  );
}

type RepoWithVercel = {
  id: string;
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

const defaultDeps: EnvVarDeps = {
  loadRepoWithVercel: async (repoId, userId) => {
    const { data, error } = await supabaseAdmin
      .from("repos")
      .select(
        "id, env_sync_mode, vercel_team_id, vercel_project_id, sandbox_billing_mode_override, workspace:workspaces(sandbox_billing_mode, sandbox_vercel_team_id, sandbox_vercel_project_id)"
      )
      .eq("id", repoId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load repo ${repoId}: ${error.message}`);
    }
    return (data ?? null) as RepoWithVercel | null;
  },
  loadUserVercelCredentials,
  getPlatformSandboxCredentials,
  listVercelProjectEnvVars,
  upsertVercelProjectEnvVar,
  deleteVercelProjectEnvVar,
};

function envVarError(
  code: MogplexApiErrorCode,
  message: string,
  status: number
): MogplexApiEnvVarResult<never> {
  return { ok: false, error: { code, message, status } };
}

function withPartialProgress(
  result: MogplexApiEnvVarResult<never>,
  verb: "Updated" | "Deleted",
  done: number,
  total: number
): MogplexApiEnvVarResult<never> {
  if (result.ok) return result;
  return {
    ok: false,
    error: {
      ...result.error,
      message: `${result.error.message} ${verb} ${done} of ${total} entries before the failure.`,
    },
  };
}

function mapVercelServiceError(
  error: VercelServiceError
): MogplexApiEnvVarResult<never> {
  switch (error.code) {
    case "AUTH_INVALID":
      return envVarError(
        "UNAUTHORIZED",
        "Reconnect Vercel or refresh the configured platform credentials.",
        401
      );
    case "PROJECT_NOT_FOUND":
      return envVarError(
        "NOT_FOUND",
        "The configured Vercel project no longer exists.",
        404
      );
    case "PROJECT_FORBIDDEN":
    case "TEAM_FORBIDDEN":
      return envVarError(
        "FORBIDDEN",
        "The configured Vercel project or team is no longer accessible.",
        403
      );
    case "RATE_LIMITED":
      return envVarError(
        "RATE_LIMITED",
        "Vercel rate limited the request.",
        429
      );
    case "NOT_CONFIGURED":
      return envVarError(
        "BAD_REQUEST",
        "Mogplex platform Vercel is not configured.",
        400
      );
    default:
      return envVarError(
        "SERVICE_UNAVAILABLE",
        "Vercel rejected the request.",
        502
      );
  }
}

type ResolvedRepoEnvAccess = {
  authMode: "platform" | "personal";
  projectId: string;
  teamId: string | null;
  vercelToken: string;
};

async function resolveRepoEnvAccess(
  userId: string,
  repoId: string,
  deps: EnvVarDeps
): Promise<MogplexApiEnvVarResult<ResolvedRepoEnvAccess>> {
  const repo = await deps.loadRepoWithVercel(repoId, userId);
  if (!repo) {
    return envVarError("NOT_FOUND", "Repo not found", 404);
  }

  const accountVercelCreds = await deps
    .loadUserVercelCredentials(userId)
    .catch(() => null);
  const platform = deps.getPlatformSandboxCredentials();
  const access = resolveRepoEnvVarAccess({
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

  if (!access.ok) {
    return envVarError("BAD_REQUEST", access.message, access.status);
  }

  return {
    ok: true,
    data: {
      authMode: access.authMode,
      projectId: access.projectId,
      teamId: access.teamId,
      vercelToken: access.vercelToken,
    },
  };
}

async function listProjectEnvVars(
  access: ResolvedRepoEnvAccess,
  deps: EnvVarDeps
): Promise<MogplexApiEnvVarResult<MogplexApiEnvVar[]>> {
  const result = await deps.listVercelProjectEnvVars({
    authMode: access.authMode,
    vercelToken: access.vercelToken,
    projectId: access.projectId,
    teamId: access.teamId,
    decrypt: false,
  });
  if (!result.ok) return mapVercelServiceError(result.error);

  return {
    ok: true,
    data: result.data.map((entry) => ({
      id: entry.id ?? null,
      key: entry.key,
      target: entry.target || [],
      type: entry.type || "encrypted",
      updatedAt: entry.updatedAt ?? null,
    })),
  };
}

export async function listMogplexApiRepoEnvVars(
  userId: string,
  repoId: string,
  overrides: Partial<EnvVarDeps> = {}
): Promise<MogplexApiEnvVarResult<{ envVars: MogplexApiEnvVar[] }>> {
  if (!MOGPLEX_VERCEL_ENV_API_AVAILABLE) return integrationRequired();
  const deps = { ...defaultDeps, ...overrides };
  const access = await resolveRepoEnvAccess(userId, repoId, deps);
  if (!access.ok) return access;

  const envVars = await listProjectEnvVars(access.data, deps);
  if (!envVars.ok) return envVars;

  return { ok: true, data: { envVars: envVars.data } };
}

export type UpsertMogplexApiRepoEnvVarInput = {
  key: string;
  value: string;
  target?: string[];
  type?: string;
};

export async function upsertMogplexApiRepoEnvVar(
  userId: string,
  repoId: string,
  input: UpsertMogplexApiRepoEnvVarInput,
  overrides: Partial<EnvVarDeps> = {}
): Promise<
  MogplexApiEnvVarResult<{
    action: "created" | "updated";
    key: string;
    updatedCount: number;
  }>
> {
  if (!MOGPLEX_VERCEL_ENV_API_AVAILABLE) return integrationRequired();
  const deps = { ...defaultDeps, ...overrides };
  const access = await resolveRepoEnvAccess(userId, repoId, deps);
  if (!access.ok) return access;

  const existing = await listProjectEnvVars(access.data, deps);
  if (!existing.ok) return existing;

  const matches = existing.data.filter(
    (entry) => entry.key === input.key && entry.id
  );

  if (matches.length === 0) {
    const created = await deps.upsertVercelProjectEnvVar({
      authMode: access.data.authMode,
      vercelToken: access.data.vercelToken,
      projectId: access.data.projectId,
      teamId: access.data.teamId,
      key: input.key,
      value: input.value,
      target: input.target,
      type: input.type,
    });
    if (!created.ok) return mapVercelServiceError(created.error);
    return {
      ok: true,
      data: { action: "created", key: input.key, updatedCount: 1 },
    };
  }

  // Retargeting several per-target entries at once would overwrite the ones
  // the caller did not mean to touch and then collide on the requested target.
  if (input.target && matches.length > 1) {
    return envVarError(
      "CONFLICT",
      `${input.key} has ${matches.length} target-specific entries. Omit target to update the value everywhere, or delete the key and recreate it with the targets you want.`,
      409
    );
  }

  let updatedCount = 0;
  for (const match of matches) {
    const updated = await deps.upsertVercelProjectEnvVar({
      authMode: access.data.authMode,
      vercelToken: access.data.vercelToken,
      projectId: access.data.projectId,
      teamId: access.data.teamId,
      envId: match.id ?? undefined,
      key: input.key,
      value: input.value,
      target: input.target,
    });
    if (!updated.ok) {
      return withPartialProgress(
        mapVercelServiceError(updated.error),
        "Updated",
        updatedCount,
        matches.length
      );
    }
    updatedCount += 1;
  }

  return {
    ok: true,
    data: { action: "updated", key: input.key, updatedCount },
  };
}

export async function deleteMogplexApiRepoEnvVar(
  userId: string,
  repoId: string,
  input: { key: string },
  overrides: Partial<EnvVarDeps> = {}
): Promise<MogplexApiEnvVarResult<{ key: string; deletedCount: number }>> {
  if (!MOGPLEX_VERCEL_ENV_API_AVAILABLE) return integrationRequired();
  const deps = { ...defaultDeps, ...overrides };
  const access = await resolveRepoEnvAccess(userId, repoId, deps);
  if (!access.ok) return access;

  const existing = await listProjectEnvVars(access.data, deps);
  if (!existing.ok) return existing;

  const matches = existing.data.filter(
    (entry) => entry.key === input.key && entry.id
  );
  if (matches.length === 0) {
    return envVarError(
      "NOT_FOUND",
      `No env var named ${input.key} exists on the linked Vercel project.`,
      404
    );
  }

  let deletedCount = 0;
  for (const match of matches) {
    const deleted = await deps.deleteVercelProjectEnvVar({
      authMode: access.data.authMode,
      vercelToken: access.data.vercelToken,
      projectId: access.data.projectId,
      teamId: access.data.teamId,
      envId: match.id!,
    });
    if (!deleted.ok) {
      return withPartialProgress(
        mapVercelServiceError(deleted.error),
        "Deleted",
        deletedCount,
        matches.length
      );
    }
    deletedCount += 1;
  }

  return {
    ok: true,
    data: { key: input.key, deletedCount },
  };
}
