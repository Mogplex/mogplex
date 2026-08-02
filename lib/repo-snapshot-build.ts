import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { enforceSnapshotBuildLimits } from "@/lib/request-limits";
import { resolveConfiguredDevPort } from "@/lib/repo-settings";
import {
  createSandboxForRepo,
  bootstrapSandbox,
  snapshotSandbox,
} from "@/lib/sandbox/client";
import { computeLockfileHashFromSandbox } from "@/lib/sandbox/lockfile-hash";
import { detectRuntimeFromGithub } from "@/lib/sandbox/runtimes";
import {
  acquireSnapshotBuildLock,
  persistSnapshotBuild,
  releaseSnapshotBuildLock,
} from "@/lib/repo-snapshots";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  cleanupPreparedSandboxVercelLink,
  getRepoLinkedVercelProject,
  resolveRepoSandboxEnv,
} from "@/lib/vercel/env-vars";
import { resolveSandboxCreateContext } from "@/lib/sandbox/context";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";
import type { LimitDecision } from "@/lib/request-limits";
import type { SandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";

export type SnapshotBuildRepoRecord = {
  id: string;
  user_id: string;
  full_name: string;
  default_branch: string | null;
  root_directory: string | null;
  sandbox_billing_target?: unknown;
  sandbox_billing_mode_override?: unknown;
  runtime: SandboxRuntime | null;
  dev_port: number;
  dev_port_auto?: unknown;
  install_command: string | null;
  dev_command: string | null;
  sandbox_env_vars?: unknown;
  env_sync_mode?: unknown;
  vercel_project_id?: string | null;
  vercel_team_id?: string | null;
  github_installation_id?: number | null;
  snapshot_id: string | null;
  snapshot_created_at?: string | null;
  snapshot_billing_source?: string | null;
  snapshot_billing_team_id?: string | null;
  snapshot_billing_project_id?: string | null;
  workspace?:
    | {
        sandbox_billing_mode?: unknown;
        sandbox_vercel_project_id?: string | null;
        sandbox_vercel_team_id?: string | null;
      }
    | Array<{
        sandbox_billing_mode?: unknown;
        sandbox_vercel_project_id?: string | null;
        sandbox_vercel_team_id?: string | null;
      }>
    | null;
};

export type RepoSnapshotBuildResult =
  | {
      status: "built";
      snapshot: {
        id: string;
        status: string;
        sizeBytes: number;
        createdAt: string;
      };
    }
  | {
      status: "rate_limited";
      decision: Extract<LimitDecision, { allowed: false }>;
    }
  | { status: "missing_github_token" }
  | {
      status: "missing_vercel_credentials";
      error: string;
      statusCode: 400 | 403 | 500;
      credentialSource: "platform" | "user";
    }
  | {
      status: "invalid_target";
      error: string;
    }
  | { status: "in_progress" }
  | { status: "superseded" };

type RepoSnapshotBuilderInput = {
  repo: SnapshotBuildRepoRecord;
  sandboxCredentials: SandboxServiceCredentials;
  preAcquiredLockToken?: string | null;
};

type RepoSnapshotBuilderDeps = {
  getGithubAccessTokenForRepo: typeof getGithubAccessTokenForRepo;
  enforceSnapshotBuildLimits: typeof enforceSnapshotBuildLimits;
  acquireSnapshotBuildLock: typeof acquireSnapshotBuildLock;
  persistSnapshotBuild: typeof persistSnapshotBuild;
  releaseSnapshotBuildLock: typeof releaseSnapshotBuildLock;
  createSandboxForRepo: typeof createSandboxForRepo;
  bootstrapSandbox: typeof bootstrapSandbox;
  snapshotSandbox: typeof snapshotSandbox;
  cleanupPreparedSandboxVercelLink: typeof cleanupPreparedSandboxVercelLink;
  detectRuntimeFromGithub: typeof detectRuntimeFromGithub;
};

const defaultRepoSnapshotBuilderDeps: RepoSnapshotBuilderDeps = {
  getGithubAccessTokenForRepo,
  enforceSnapshotBuildLimits,
  acquireSnapshotBuildLock,
  persistSnapshotBuild,
  releaseSnapshotBuildLock,
  createSandboxForRepo,
  bootstrapSandbox,
  snapshotSandbox,
  cleanupPreparedSandboxVercelLink,
  detectRuntimeFromGithub,
};

export async function loadRepoSnapshotBuildRepo(
  repoId: string,
  userId?: string
) {
  let query = supabaseAdmin
    .from("repos")
    .select(
      "*, workspace:workspaces(sandbox_billing_mode, sandbox_vercel_project_id, sandbox_vercel_team_id)"
    )
    .eq("id", repoId);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load repo ${repoId} for snapshot build: ${error.message}`
    );
  }

  return (data as SnapshotBuildRepoRecord | null) ?? null;
}

export function createRepoSnapshotBuilder(
  overrides: Partial<RepoSnapshotBuilderDeps> = {}
) {
  const deps: RepoSnapshotBuilderDeps = {
    ...defaultRepoSnapshotBuilderDeps,
    ...overrides,
  };

  return async function buildRepoSnapshot(
    input: RepoSnapshotBuilderInput
  ): Promise<RepoSnapshotBuildResult> {
    const githubToken = await deps.getGithubAccessTokenForRepo(input.repo);
    if (!githubToken) {
      return { status: "missing_github_token" };
    }

    const workspace = Array.isArray(input.repo.workspace)
      ? input.repo.workspace[0]
      : input.repo.workspace;
    const createContextResult = await resolveSandboxCreateContext({
      sandboxCredentials: input.sandboxCredentials,
      workspaceBillingModeInput: workspace?.sandbox_billing_mode,
      repoBillingModeOverrideInput: input.repo.sandbox_billing_mode_override,
      repoLinkedProjectId: input.repo.vercel_project_id,
      repoLinkedTeamId: input.repo.vercel_team_id,
      workspaceLinkedProjectId: workspace?.sandbox_vercel_project_id,
      workspaceLinkedTeamId: workspace?.sandbox_vercel_team_id,
      includeAi: false,
    });
    if (!createContextResult.ok) {
      return createContextResult.credentialSource
        ? {
            status: "missing_vercel_credentials",
            error: createContextResult.error,
            statusCode: createContextResult.status,
            credentialSource:
              createContextResult.credentialSource ?? "platform",
          }
        : { status: "invalid_target", error: createContextResult.error };
    }
    const createContext = createContextResult.context;
    const sandboxCredentials = createContext.credentials;

    const configuredDevPort = resolveConfiguredDevPort(
      input.repo.dev_port,
      input.repo.dev_port_auto
    );
    const runtime: SandboxRuntime =
      input.repo.runtime ||
      (await deps.detectRuntimeFromGithub(
        input.repo.full_name,
        githubToken,
        input.repo.default_branch ?? undefined,
        input.repo.root_directory
      ));

    const providedToken = input.preAcquiredLockToken?.trim() || null;
    const lock = providedToken
      ? { acquired: true as const, token: providedToken }
      : await deps.acquireSnapshotBuildLock(input.repo.id);

    if (!lock.acquired) {
      return { status: "in_progress" };
    }

    let ephemeral: Awaited<ReturnType<typeof createSandboxForRepo>> | null =
      null;

    try {
      const limitDecision = await deps.enforceSnapshotBuildLimits({
        userId: input.repo.user_id,
        repoId: input.repo.id,
        hasSnapshot: Boolean(input.repo.snapshot_id),
        lastSnapshotCreatedAt: input.repo.snapshot_created_at ?? null,
      });

      if (!limitDecision.allowed) {
        return {
          status: "rate_limited",
          decision: limitDecision,
        };
      }

      const envResolution = await resolveRepoSandboxEnv({
        repo: input.repo,
        userId: input.repo.user_id,
      });

      ephemeral = await deps.createSandboxForRepo({
        vercelToken: sandboxCredentials.vercelToken,
        vercelTeamId: sandboxCredentials.vercelTeamId,
        vercelProjectId: sandboxCredentials.vercelProjectId,
        githubToken,
        repoFullName: input.repo.full_name,
        branch: input.repo.default_branch || "main",
        runtime,
        devPort: configuredDevPort,
        timeoutMs: 300_000,
        envVars: envResolution.envVars,
      });

      await deps.bootstrapSandbox(ephemeral, {
        rootDirectory: input.repo.root_directory,
        installCommand: input.repo.install_command,
        devCommand: input.repo.dev_command,
        devPort: configuredDevPort,
        envVars: envResolution.envVars,
        envSyncMode: envResolution.sync.mode,
        linkedVercelProject: getRepoLinkedVercelProject(input.repo),
        runtime,
      });

      await deps.cleanupPreparedSandboxVercelLink(ephemeral, {
        rootDirectory: input.repo.root_directory,
      });

      const [lockfileHashResult, commitSha] = await Promise.all([
        computeLockfileHashFromSandbox(
          ephemeral,
          input.repo.root_directory
        ).catch((error) => {
          console.warn("[snapshot/build] Lockfile hash capture failed", error);
          return null;
        }),
        readCommitShaFromSandbox(ephemeral).catch((error) => {
          console.warn("[snapshot/build] Commit SHA capture failed", error);
          return null;
        }),
      ]);

      const snapshot = await deps.snapshotSandbox(ephemeral);
      ephemeral = null;

      const persisted = await deps.persistSnapshotBuild(
        input.repo.id,
        lock.token,
        snapshot.snapshotId,
        {
          billingSource: createContext.ownership.billingSource,
          billingProjectId: sandboxCredentials.vercelProjectId,
          billingTeamId: sandboxCredentials.vercelTeamId,
        },
        {
          lockfileHash: lockfileHashResult?.hash ?? null,
          commitSha: commitSha ?? null,
        }
      );
      if (!persisted) {
        return { status: "superseded" };
      }

      return {
        status: "built",
        snapshot: {
          id: snapshot.snapshotId,
          status: snapshot.status,
          sizeBytes: snapshot.sizeBytes,
          createdAt: snapshot.createdAt.toISOString(),
        },
      };
    } catch (error) {
      if (ephemeral) {
        try {
          await ephemeral.stop();
        } catch {
          // Best-effort cleanup for failed snapshot builds.
        }
      }
      throw error;
    } finally {
      try {
        await deps.releaseSnapshotBuildLock(input.repo.id, lock.token);
      } catch (error) {
        console.warn("[snapshot/build] Failed to release snapshot lock", {
          repoId: input.repo.id,
          error:
            error instanceof Error
              ? error.message
              : "Unknown lock release error",
        });
      }
    }
  };
}

export const buildRepoSnapshot = createRepoSnapshotBuilder();

async function readCommitShaFromSandbox(
  sandbox: Awaited<ReturnType<typeof createSandboxForRepo>>
): Promise<string | null> {
  try {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", "git rev-parse HEAD"],
    });
    const stdout = await result.stdout();
    const sha = stdout.trim();
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}
