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

export function getRepoLinkedVercelProject(
  _repo: RepoSandboxEnvRepo
): LinkedVercelProject | null {
  // Legacy project fields remain readable, but no longer enable env import.
  return null;
}

export async function resolveRepoSandboxEnv(opts: {
  repo: RepoSandboxEnvRepo;
  userId: string;
}): Promise<RepoSandboxEnvResolution> {
  return {
    envVars: normalizeEnvVars(opts.repo.sandbox_env_vars),
    sync: {
      mode: resolveEffectiveEnvSyncMode(opts.repo.env_sync_mode),
      source: "manual",
      warning: null,
    },
  };
}
