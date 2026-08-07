import { getOAuthToken } from "@/lib/oauth-tokens";
import {
  resolveEffectiveEnvSyncMode,
  normalizeEnvVars,
} from "@/lib/repo-settings";
import type { EnvSyncMode, RepoEnvVars } from "@/lib/repo-settings";

export type { PrepareSandboxVercelLinkResult } from "./env-vars-link";
export {
  prepareSandboxVercelLink,
  cleanupPreparedSandboxVercelLink,
} from "./env-vars-link";

export type VercelEnvVar = {
  id?: string;
  key: string;
  value?: string;
  target?: string[];
  type?: "encrypted" | "plain" | "secret" | "system";
  configurationId?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

const DEFAULT_TARGET_PRIORITY = ["preview", "development"] as const;
const ENV_SYNC_LOG_PREFIX = "[vercel/env-sync]";

type RepoSandboxEnvRepo = {
  sandbox_env_vars?: unknown;
  env_sync_mode?: unknown;
  vercel_project_id?: string | null;
  vercel_team_id?: string | null;
};

export type LinkedVercelProject = {
  projectId: string;
  teamId?: string | null;
};

export type RepoSandboxEnvResolution = {
  envVars: RepoEnvVars;
  sync: {
    mode: EnvSyncMode;
    source: "manual" | "vercel-project" | "manual+vercel-project";
    warning: string | null;
  };
};

function buildProjectEnvUrl(opts: {
  vercelProjectId: string;
  vercelTeamId?: string | null;
  decrypt?: boolean;
}) {
  const base = `https://api.vercel.com/v10/projects/${opts.vercelProjectId}/env`;
  const params = new URLSearchParams();
  if (opts.vercelTeamId && opts.vercelTeamId !== "personal") {
    params.set("teamId", opts.vercelTeamId);
  }
  if (opts.decrypt) {
    params.set("decrypt", "true");
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

async function getUserVercelToken(userId: string) {
  return getOAuthToken(userId, "vercel");
}

function resolveSyncSource(
  manualEnvVars: RepoEnvVars,
  vercelEnvVars: RepoEnvVars
): RepoSandboxEnvResolution["sync"]["source"] {
  const hasManual = Object.keys(manualEnvVars).length > 0;
  const hasVercel = Object.keys(vercelEnvVars).length > 0;
  if (hasManual && hasVercel) return "manual+vercel-project";
  if (hasVercel) return "vercel-project";
  return "manual";
}

function warnAndReturnFallback(
  mode: EnvSyncMode,
  manualEnvVars: RepoEnvVars,
  warning: string,
  error?: unknown
): RepoSandboxEnvResolution {
  if (error) {
    console.warn(ENV_SYNC_LOG_PREFIX, warning, error);
  } else {
    console.warn(ENV_SYNC_LOG_PREFIX, warning);
  }

  return {
    envVars: manualEnvVars,
    sync: {
      mode,
      source: "manual",
      warning,
    },
  };
}

export async function fetchVercelProjectEnvEntries(opts: {
  vercelToken: string;
  vercelProjectId: string;
  vercelTeamId?: string | null;
  decrypt?: boolean;
}): Promise<VercelEnvVar[]> {
  const res = await fetch(
    buildProjectEnvUrl({
      vercelProjectId: opts.vercelProjectId,
      vercelTeamId: opts.vercelTeamId,
      decrypt: opts.decrypt,
    }),
    {
      headers: {
        Authorization: `Bearer ${opts.vercelToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vercel API (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { envs?: VercelEnvVar[] };
  return data.envs ?? [];
}

export function flattenVercelProjectEnvVars(
  envs: VercelEnvVar[],
  targetPriority: readonly string[] = DEFAULT_TARGET_PRIORITY
): RepoEnvVars {
  const result: RepoEnvVars = {};

  for (const target of targetPriority) {
    for (const env of envs) {
      if (!env.key || env.value == null) continue;
      const envTargets = env.target ?? [];
      if (!envTargets.includes(target)) continue;
      if (!(env.key in result)) {
        result[env.key] = env.value;
      }
    }
  }

  return result;
}

export function mergeRepoSandboxEnvVars(
  vercelEnvVars: RepoEnvVars,
  manualEnvVars: RepoEnvVars
): RepoEnvVars {
  return {
    ...vercelEnvVars,
    ...manualEnvVars,
  };
}

export function getRepoLinkedVercelProject(
  repo: RepoSandboxEnvRepo
): LinkedVercelProject | null {
  if (
    resolveEffectiveEnvSyncMode(repo.env_sync_mode) !== "vercel-project" ||
    !repo.vercel_project_id
  ) {
    return null;
  }

  return {
    projectId: repo.vercel_project_id,
    teamId: repo.vercel_team_id,
  };
}

export async function resolveRepoSandboxEnv(opts: {
  repo: RepoSandboxEnvRepo;
  userId: string;
}): Promise<RepoSandboxEnvResolution> {
  const mode = resolveEffectiveEnvSyncMode(opts.repo.env_sync_mode);
  const manualEnvVars = normalizeEnvVars(opts.repo.sandbox_env_vars);

  if (mode !== "vercel-project") {
    return {
      envVars: manualEnvVars,
      sync: {
        mode,
        source: "manual",
        warning: null,
      },
    };
  }

  if (!opts.repo.vercel_project_id) {
    return warnAndReturnFallback(
      mode,
      manualEnvVars,
      "Linked Vercel project env sync skipped: no Vercel project is linked; using manual env vars only."
    );
  }

  let vercelToken: string | null;
  try {
    vercelToken = await getUserVercelToken(opts.userId);
  } catch (error) {
    return warnAndReturnFallback(
      mode,
      manualEnvVars,
      "Linked Vercel project env sync skipped: failed to load the connected Vercel token; using manual env vars only.",
      error
    );
  }

  if (!vercelToken) {
    return warnAndReturnFallback(
      mode,
      manualEnvVars,
      "Linked Vercel project env sync skipped: reconnect Vercel to restore project env access; using manual env vars only."
    );
  }

  try {
    const vercelEntries = await fetchVercelProjectEnvEntries({
      vercelToken,
      vercelProjectId: opts.repo.vercel_project_id,
      vercelTeamId: opts.repo.vercel_team_id,
      decrypt: true,
    });
    const vercelEnvVars = flattenVercelProjectEnvVars(vercelEntries);

    return {
      envVars: mergeRepoSandboxEnvVars(vercelEnvVars, manualEnvVars),
      sync: {
        mode,
        source: resolveSyncSource(manualEnvVars, vercelEnvVars),
        warning: null,
      },
    };
  } catch (error) {
    return warnAndReturnFallback(
      mode,
      manualEnvVars,
      "Linked Vercel project env sync failed; using manual env vars only.",
      error
    );
  }
}
