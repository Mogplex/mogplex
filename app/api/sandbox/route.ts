import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getSandboxServiceCredentials,
  isSandboxCapabilityDeniedError,
  type SandboxServiceCredentials,
} from "@/lib/sandbox/get-user-credentials";
import {
  readActiveTeamIdHeader,
  resolveActiveTeamCapabilities,
} from "@/lib/team-capabilities";
import {
  BaselineSnapshotRestoreError,
  SandboxBootstrapError,
  SandboxCreateRequestValidationError,
  bootstrapFromBaselineSnapshotStreaming,
  bootstrapFromSnapshotStreaming,
  bootstrapSandboxStreaming,
  createSandboxForRepo,
  createSandboxFromSnapshot,
  persistentSandboxesDisabledByEnv,
  previewAllowsRoot404,
} from "@/lib/sandbox/client";
import { loadUserPlatformAccess } from "@/lib/platform-access";
import {
  pickSandboxSource,
  type SandboxSource,
} from "@/lib/sandbox/source-selection";
import { getOwnedRepoWithGithubAccessToken } from "@/lib/github-access";
import {
  normalizeRootDirectory,
  resolveConfiguredDevPort,
  resolveEffectiveSandboxTimeoutMs,
} from "@/lib/repo-settings";
import {
  getRepoLinkedVercelProject,
  resolveRepoSandboxEnv,
} from "@/lib/vercel/env-vars";
import { detectRuntimeFromGithub } from "@/lib/sandbox/runtimes";
import { resolveSandboxGitAuthor } from "@/lib/sandbox/git-author";
import { clearRepoSnapshotIfCurrent } from "@/lib/repo-snapshots";
import {
  buildLimitResponse,
  enforceSandboxBootLimits,
  releaseLimitClaim,
} from "@/lib/request-limits";
import {
  ACTIVE_SANDBOX_STATUSES,
  stopSandboxRecord,
  updateSandboxRecord,
} from "@/lib/sandbox/records";
import { checkSandboxHealth } from "@/lib/sandbox/health-status";
import { startDeferredRepoSnapshotBuild } from "@/lib/workflows/repo-snapshot-workflow";
import { startSandboxReadinessReconciliation } from "@/lib/sandbox/readiness-reconciliation";
import { resolveSandboxAiAccess } from "@/lib/sandbox/ai-runtime";
import {
  extractVercelApiErrorCode,
  extractVercelApiErrorDetail,
} from "@/lib/sandbox/api-error";
import { resolveSandboxCreateContext } from "@/lib/sandbox/context";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { loadSandboxVercelDiagnostics } from "@/lib/vercel/load-sandbox-diagnostics";
import {
  resolveBillingLinkedProjectOwner,
  resolveBillingLinkedProjectSelection,
} from "@/lib/vercel/target-resolution";
import { validateVercelProjectAccess } from "@/lib/vercel/service";
import { deriveVercelLinkedProjectValidation } from "@/lib/vercel/validation";
import { buildPersistedVercelLinkStateFromValidation } from "@/lib/vercel/reconciliation";
import {
  findStaleActiveSandboxIds,
  resolveActiveSandboxState,
} from "@/lib/sandbox/liveness";
import { applyProductTeamScope } from "@/lib/sandbox/product-team-scope";
import {
  isValidSandboxRootDirectory,
  resolveSandboxLaunchRequest,
} from "@/lib/sandbox/launch-config";
import { resolveNameCollision } from "@/lib/sandbox/launch";
import { buildSandboxName } from "@/lib/sandbox/sandbox-name";
import { readSandboxPersistentFlag } from "@/lib/sandbox/persistence";
import {
  createSandboxBillingOnResume,
  prepareSandboxBillingClose,
  requireSandboxBillingSession,
} from "@/lib/billing/sandbox-usage";
import type { PersistedVercelLinkState } from "@/lib/vercel/reconciliation";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";
import type {
  ResolvedSandboxLaunchRequest,
  SandboxLaunchRequestInput,
} from "@/lib/sandbox/launch-config";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxRecord, SandboxRecordRow, StopReason } from "@/lib/types";
import type { VercelAuthMode } from "@/lib/vercel/service";

function sseEncode(event: SandboxEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const SANDBOX_STREAM_SELECT =
  "id, sandbox_id, repo_id, user_id, product_team_id, actor_user_id, base_branch, working_branch, limit_claim_id, status, stop_reason, preview_url, snapshot_id, install_log, dev_log, runtime, health_status, error, terminal_cwd, root_directory, persistent, last_health_check_at, last_preview_http_status, last_preview_error, last_boot_error, boot_attempts, last_boot_started_at, last_boot_completed_at, created_at, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, exec_lock_token, exec_lock_started_at";

const SANDBOX_POST_REPO_SELECT =
  "*, workspace:workspaces(id, sandbox_billing_mode, sandbox_timeout_ms, sandbox_vercel_project_id, sandbox_vercel_team_id)";

const SANDBOX_SNAPSHOT_WARMUP_ENV = "ENABLE_SANDBOX_SNAPSHOT_WARMUP";

function isTruthyEnvFlag(value: string | undefined) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

type DeferredSnapshotWarmupQueueResult = Awaited<
  ReturnType<typeof startDeferredRepoSnapshotBuild>
>;

type SandboxCreateContextResult = Awaited<
  ReturnType<typeof resolveSandboxCreateContext>
>;

type ResolvedSandboxCreateContext = Extract<
  SandboxCreateContextResult,
  { ok: true }
>["context"];

type SandboxInstance = Awaited<ReturnType<typeof createSandboxForRepo>>;

type SandboxLaunchPreparation = {
  creds: SandboxServiceCredentials;
  productTeamId: string | null;
  actorUserId: string;
  repo: SandboxRepoRecord;
  githubToken: string;
  launchRequest: ResolvedSandboxLaunchRequest;
  repoId: string;
  /**
   * Effective working subdirectory for this sandbox, computed once at the
   * top of the launch flow and threaded everywhere instead of reading
   * `repo.root_directory` directly. Honours an explicit launch-time
   * override, otherwise falls back to the repo's persistent default.
   * `null` means "repo root".
   */
  effectiveRootDirectory: string | null;
  linkedProjectOwner: ReturnType<typeof resolveBillingLinkedProjectOwner>;
  linkedProject: ReturnType<typeof resolveBillingLinkedProjectSelection>;
  createContext: ResolvedSandboxCreateContext;
  effectiveSandboxTimeoutMs: number;
  configuredDevPort: number | null;
  cloneRevision: string;
  allowSnapshotRestore: boolean;
  runtime: SandboxRuntime;
  healthCheckOptions: {
    treatRoot404AsReady: boolean;
  };
  sandboxSource: SandboxSource;
};

function resolveLaunchRootDirectory(input: {
  request: ResolvedSandboxLaunchRequest;
  repo: Pick<SandboxRepoRecord, "root_directory">;
}): string | null {
  // undefined → field not in request body, use the repo default
  // null      → caller explicitly chose repo root
  // string    → caller chose this subdirectory
  if (input.request.rootDirectory === undefined) {
    return input.repo.root_directory ?? null;
  }
  return input.request.rootDirectory;
}

type PendingSandboxLaunchRecord = {
  record: SandboxRecordRow;
  limitClaimId: string | null;
};

type SandboxLaunchState = {
  sandbox: SandboxInstance | null;
  previewUrl: string | null;
  restoredFromSnapshot: boolean;
  restoredFromBaselineSnapshot: boolean;
  shouldQueueDeferredSnapshot: boolean;
  streamSandboxRecord: SandboxRecordRow;
};

type SandboxLaunchEnvironment = {
  envResolution: Awaited<ReturnType<typeof resolveRepoSandboxEnv>>;
  networkPolicy: Parameters<typeof createSandboxForRepo>[0]["networkPolicy"];
};

type SandboxLaunchRuntimePreparation = Pick<
  SandboxLaunchPreparation,
  | "configuredDevPort"
  | "cloneRevision"
  | "allowSnapshotRestore"
  | "runtime"
  | "healthCheckOptions"
  | "sandboxSource"
>;

type SandboxRouteResponseResult = { response: Response };
type SandboxCreateContextResolution =
  | SandboxRouteResponseResult
  | { createContext: ResolvedSandboxCreateContext };
type SandboxRepoAccessResolution =
  | SandboxRouteResponseResult
  | { repo: SandboxRepoRecord; githubToken: string };
type SandboxLaunchRequestResolution =
  | SandboxRouteResponseResult
  | { launchRequest: ResolvedSandboxLaunchRequest };
type SandboxLaunchPreparationResult =
  | SandboxRouteResponseResult
  | { launch: SandboxLaunchPreparation };
type SandboxBootLimitClaimResolution =
  | SandboxRouteResponseResult
  | { limitClaimId: string | null };
type PendingSandboxLaunchRecordResult =
  | SandboxRouteResponseResult
  | PendingSandboxLaunchRecord;

export function shouldQueueSnapshotWarmupOnSandboxLaunch(
  env: NodeJS.ProcessEnv = process.env
) {
  return isTruthyEnvFlag(env[SANDBOX_SNAPSHOT_WARMUP_ENV]);
}

export function summarizeDeferredSnapshotWarmupQueueResult(
  result: DeferredSnapshotWarmupQueueResult
) {
  if (result.queued) {
    return {
      logLevel: "info" as const,
      logMessage: "[sandbox/create] Queued deferred snapshot build",
      warningMessage: null,
      details: {
        runtimeProvider: result.runtimeProvider,
        runtimeRunId: result.runtimeRunId,
        workflowRunId: result.workflowRunId,
      },
    };
  }

  switch (result.reason) {
    case "snapshot_exists":
      return {
        logLevel: "info" as const,
        logMessage:
          "[sandbox/create] Skipped deferred snapshot build because a snapshot already exists",
        warningMessage: null,
        details: { reason: result.reason },
      };
    case "in_progress":
      return {
        logLevel: "info" as const,
        logMessage:
          "[sandbox/create] Deferred snapshot build is already in progress",
        warningMessage: null,
        details: { reason: result.reason },
      };
    case "repo_not_found":
    case "not_found":
      return {
        logLevel: "warn" as const,
        logMessage:
          "[sandbox/create] Deferred snapshot build could not be queued because the repo state was unavailable",
        warningMessage: "Automatic snapshot warmup could not be queued.",
        details: { reason: result.reason },
      };
    default:
      return {
        logLevel: "warn" as const,
        logMessage:
          "[sandbox/create] Deferred snapshot build was skipped for an unexpected reason",
        warningMessage: "Automatic snapshot warmup could not be queued.",
        details: { reason: result.reason },
      };
  }
}

function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

/**
 * Local twin of buildShellCommand in lib/sandbox/client.ts, used here
 * for the working-branch creation path inside createWorkingBranchInSandbox.
 *
 * INVARIANT: rootDirectory MUST have been validated upstream by
 * isValidSandboxRootDirectory (the launch flow does this before
 * effectiveRootDirectory is computed). The assertion here is the same
 * defensive guard as the client-side twin so a future caller that
 * skips the launch validator cannot smuggle a NUL byte / parent
 * traversal / absolute path into a single-quoted shell argument.
 *
 * Mirrors lib/sandbox/client.ts exactly: normalize first (so a
 * pre-normalized "./foo/" or trailing-slash variant emits the same
 * `cd 'foo' && …` as the client twin), then emit.
 */
function buildShellCommand(command: string, rootDirectory?: string | null) {
  if (!isValidSandboxRootDirectory(rootDirectory)) {
    throw new TypeError(
      "buildShellCommand: rootDirectory must pass isValidSandboxRootDirectory"
    );
  }
  const normalizedRoot = normalizeRootDirectory(rootDirectory);
  if (!normalizedRoot) return command;
  return `cd '${escapeShell(normalizedRoot)}' && ${command}`;
}

async function createWorkingBranchInSandbox(
  sandbox: Awaited<ReturnType<typeof createSandboxForRepo>>,
  input: ResolvedSandboxLaunchRequest & { rootDirectory?: string | null }
) {
  const result = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      buildShellCommand(
        `git switch -c '${escapeShell(input.workingBranch)}' && git push -u origin '${escapeShell(input.workingBranch)}'`,
        input.rootDirectory
      ),
    ],
  });

  if (result.exitCode === 0) return;

  const [stdout, stderr] = await Promise.all([
    result.stdout(),
    result.stderr(),
  ]);
  const detail = [stdout, stderr].filter(Boolean).join("\n").trim();
  throw new Error(
    detail || `Failed to create working branch ${input.workingBranch}`
  );
}

function toStreamSandboxRecord(record: SandboxRecordRow | SandboxRecord) {
  return toSandboxClientRecord(record);
}

function isSandboxClientRecord(
  record: SandboxRecordRow | SandboxRecord
): record is SandboxRecord {
  return (
    "billing_summary" in record &&
    "runtime_summary" in record &&
    "error_summary" in record
  );
}

export function toStreamStatusSandboxRecord(
  record: SandboxRecordRow | SandboxRecord
) {
  return isSandboxClientRecord(record) ? record : toStreamSandboxRecord(record);
}

type SandboxActiveRepoJoin = {
  full_name?: string | null;
  sandbox_timeout_ms?: number | null;
  workspaces?:
    | { name?: string | null; sandbox_timeout_ms?: number | null }
    | { name?: string | null; sandbox_timeout_ms?: number | null }[]
    | null;
};

/**
 * Flat, CLI-shaped sandbox record returned when a caller passes
 * `?format=cli`. The mogplex CLI's sandbox dashboard consumes this.
 */
export type CliSandboxRecord = {
  id: string;
  sandboxId: string | null;
  repo: string | null;
  workspace: string | null;
  branch: string | null;
  status: string;
  createdAt: string;
  url: string | null;
};

/**
 * Statuses the CLI dashboard surfaces. Historical records (stopped, error)
 * are filtered out — the CLI only needs things the user might act on.
 */
const CLI_VISIBLE_STATUSES: ReadonlySet<string> = new Set([
  "creating",
  "installing",
  "running",
  "paused",
]);

function toCliSandboxRecord(record: ActiveSandboxRecord): CliSandboxRecord {
  const repo = Array.isArray(record.repos) ? record.repos[0] : record.repos;
  const workspace = repo?.workspaces
    ? Array.isArray(repo.workspaces)
      ? repo.workspaces[0]
      : repo.workspaces
    : null;
  return {
    id: record.id,
    sandboxId:
      record.sandbox_id && record.sandbox_id !== "pending"
        ? record.sandbox_id
        : null,
    repo: repo?.full_name ?? null,
    workspace: workspace?.name ?? null,
    branch: record.working_branch || null,
    status: record.status,
    createdAt: record.created_at,
    url: record.preview_url,
  };
}

function readSandboxFormat(request: Request): "cli" | null {
  try {
    return new URL(request.url).searchParams.get("format") === "cli"
      ? "cli"
      : null;
  } catch {
    return null;
  }
}

type ActiveSandboxRecord = {
  id: string;
  sandbox_id: string;
  repo_id: string;
  user_id: string;
  product_team_id?: string | null;
  actor_user_id?: string | null;
  base_branch: string;
  working_branch: string;
  snapshot_id?: string | null;
  install_log?: string | null;
  dev_log?: string | null;
  status: string;
  stop_reason?: StopReason | null;
  preview_url: string | null;
  runtime: string | null;
  terminal_cwd?: string | null;
  health_status: string;
  last_preview_http_status?: number | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  boot_attempts?: number;
  last_boot_started_at?: string | null;
  last_boot_completed_at?: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  created_at: string;
  last_active_at: string;
  persistent?: boolean | null;
  repos?: SandboxActiveRepoJoin | SandboxActiveRepoJoin[] | null;
  effective_timeout_ms?: number | null;
};

function resolveEffectiveTimeoutFromActiveRecord(
  record: ActiveSandboxRecord
): number {
  const repo = Array.isArray(record.repos) ? record.repos[0] : record.repos;
  const workspace = repo?.workspaces
    ? Array.isArray(repo.workspaces)
      ? repo.workspaces[0]
      : repo.workspaces
    : null;
  return resolveEffectiveSandboxTimeoutMs({
    repoTimeoutMs: repo?.sandbox_timeout_ms,
    workspaceTimeoutMs: workspace?.sandbox_timeout_ms,
  });
}

type SandboxRepoRecord = {
  id: string;
  user_id: string;
  full_name: string;
  default_branch: string | null;
  root_directory: string | null;
  sandbox_billing_mode_override?: unknown;
  runtime: SandboxRuntime | null;
  dev_port: number;
  dev_port_auto?: unknown;
  sandbox_timeout_ms: number | null;
  snapshot_id: string | null;
  install_command: string | null;
  dev_command: string | null;
  sandbox_env_vars?: unknown;
  env_sync_mode?: unknown;
  vercel_project_id?: string | null;
  vercel_team_id?: string | null;
  github_installation_id?: number | null;
  workspace?:
    | {
        id?: string;
        sandbox_billing_mode?: unknown;
        sandbox_timeout_ms?: number | null;
        sandbox_vercel_project_id?: string | null;
        sandbox_vercel_team_id?: string | null;
      }
    | Array<{
        id?: string;
        sandbox_billing_mode?: unknown;
        sandbox_timeout_ms?: number | null;
        sandbox_vercel_project_id?: string | null;
        sandbox_vercel_team_id?: string | null;
      }>
    | null;
};

type SandboxPostDeps = {
  getSandboxServiceCredentials: typeof getSandboxServiceCredentials;
  getOwnedRepoWithGithubAccessToken: (
    repoId: string,
    userId: string,
    options?: { select?: string; productTeamId?: string | null }
  ) => Promise<{ repo: SandboxRepoRecord | null; githubToken: string | null }>;
  getActiveSandboxForRepo: typeof getActiveSandboxForRepo;
  stopSandboxRecord: typeof stopSandboxRecord;
  createSandboxForRepo: typeof createSandboxForRepo;
  createSandboxFromSnapshot: typeof createSandboxFromSnapshot;
  requireSandboxBillingSession: typeof requireSandboxBillingSession;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  resolveNameCollision: typeof resolveNameCollision;
  enforceSandboxBootLimits: typeof enforceSandboxBootLimits;
  startDeferredRepoSnapshotBuild: typeof startDeferredRepoSnapshotBuild;
  startSandboxReadinessReconciliation: typeof startSandboxReadinessReconciliation;
  resolveSandboxAiAccess: typeof resolveSandboxAiAccess;
  resolveActiveSandboxState: typeof resolveActiveSandboxState;
  validateVercelProjectAccess: typeof validateVercelProjectAccess;
  persistRepoVercelLinkState: (
    repoId: string,
    userId: string,
    state: PersistedVercelLinkState
  ) => Promise<void>;
  persistWorkspaceVercelLinkState: (
    workspaceId: string,
    userId: string,
    state: PersistedVercelLinkState
  ) => Promise<void>;
};

async function getActiveSandboxForRepo(
  repoId: string,
  userId: string,
  workingBranch?: string | null,
  rootDirectory?: string | null,
  productTeamId?: string | null
) {
  let query = supabaseAdmin
    .from("sandboxes")
    .select(
      "id, sandbox_id, repo_id, user_id, product_team_id, actor_user_id, base_branch, working_branch, snapshot_id, stop_reason, install_log, dev_log, status, preview_url, runtime, terminal_cwd, root_directory, persistent, health_status, last_preview_http_status, last_preview_error, last_boot_error, boot_attempts, last_boot_started_at, last_boot_completed_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, created_at, last_active_at"
    )
    .eq("repo_id", repoId)
    .eq("user_id", userId)
    .in("status", ACTIVE_SANDBOX_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);

  if (workingBranch?.trim()) {
    query = query.eq("working_branch", workingBranch.trim());
  }

  // rootDirectory === undefined  → caller doesn't care, return any path's
  //                                 sandbox (legacy behaviour, used by
  //                                 settings/observability lookups).
  // rootDirectory === null       → match rows with no root override
  //                                 (sandbox running at repo root).
  // rootDirectory is a string    → match exactly.
  if (rootDirectory === null) {
    query = query.is("root_directory", null);
  } else if (typeof rootDirectory === "string") {
    query = query.eq("root_directory", rootDirectory);
  }
  query = applyProductTeamScope(query, productTeamId);

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Failed to load active sandboxes for repo ${repoId}: ${error.message}`
    );
  }

  return ((data ?? [])[0] ?? null) as ActiveSandboxRecord | null;
}

const defaultSandboxPostDeps: SandboxPostDeps = {
  getSandboxServiceCredentials,
  getOwnedRepoWithGithubAccessToken: (repoId, userId, options) =>
    getOwnedRepoWithGithubAccessToken<SandboxRepoRecord>(
      repoId,
      userId,
      options
    ),
  getActiveSandboxForRepo,
  stopSandboxRecord,
  createSandboxForRepo,
  createSandboxFromSnapshot,
  requireSandboxBillingSession,
  prepareSandboxBillingClose,
  resolveNameCollision,
  enforceSandboxBootLimits,
  startDeferredRepoSnapshotBuild,
  startSandboxReadinessReconciliation,
  resolveSandboxAiAccess,
  resolveActiveSandboxState,
  validateVercelProjectAccess,
  async persistRepoVercelLinkState(repoId, userId, state) {
    const { error } = await supabaseAdmin
      .from("repos")
      .update(state)
      .eq("id", repoId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(
        `Failed to persist repo Vercel link state for ${repoId}: ${error.message}`
      );
    }
  },
  async persistWorkspaceVercelLinkState(workspaceId, userId, state) {
    const { error } = await supabaseAdmin
      .from("workspaces")
      .update(state)
      .eq("id", workspaceId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(
        `Failed to persist workspace Vercel link state for ${workspaceId}: ${error.message}`
      );
    }
  },
};

function toWorkspace(record: SandboxRepoRecord["workspace"]) {
  return Array.isArray(record) ? record[0] : record;
}

async function persistLinkedProjectState(
  deps: Pick<
    SandboxPostDeps,
    "persistRepoVercelLinkState" | "persistWorkspaceVercelLinkState"
  >,
  input: {
    repo: SandboxRepoRecord;
    userId: string;
    source: "repo" | "workspace" | "account" | null;
    state: PersistedVercelLinkState;
  }
) {
  if (input.source === "repo") {
    await deps.persistRepoVercelLinkState(
      input.repo.id,
      input.userId,
      input.state
    );
    return;
  }

  if (input.source === "workspace") {
    const workspace = toWorkspace(input.repo.workspace);
    if (workspace?.id) {
      await deps.persistWorkspaceVercelLinkState(
        workspace.id,
        input.userId,
        input.state
      );
    }
  }

  // "account" or null source: nothing to persist on the repo/workspace
  // record — the account-default project lives on the profile and is managed
  // independently.
}

function releaseSandboxBootLimitClaim(userId: string, claimId: string | null) {
  if (!claimId) return Promise.resolve();
  return releaseLimitClaim({
    userId,
    routeKey: "sandbox_boot",
    claimId,
  });
}

function shouldPersistLinkedProjectAccessFailure(code: string) {
  return (
    code === "AUTH_INVALID" ||
    code === "PROJECT_NOT_FOUND" ||
    code === "PROJECT_FORBIDDEN" ||
    code === "TEAM_FORBIDDEN"
  );
}

async function handleSandboxCreateContextFailure(input: {
  deps: SandboxPostDeps;
  creds: SandboxServiceCredentials;
  repo: SandboxRepoRecord;
  linkedProjectOwner: ReturnType<typeof resolveBillingLinkedProjectOwner>;
  linkedProject: ReturnType<typeof resolveBillingLinkedProjectSelection>;
  createContextResult: Extract<SandboxCreateContextResult, { ok: false }>;
}): Promise<SandboxRouteResponseResult> {
  if (
    input.linkedProject.billingMode === "user_vercel_project" &&
    (!input.linkedProject.projectId ||
      input.createContextResult.credentialSource === "user")
  ) {
    const state = buildPersistedVercelLinkStateFromValidation({
      source: input.linkedProjectOwner,
      billingMode: "user_vercel_project",
      projectId: input.linkedProject.projectId,
      personalState: input.linkedProject.projectId ? "not_linked" : "linked",
      access: null,
      checkedAt: new Date().toISOString(),
    });
    await persistLinkedProjectState(input.deps, {
      repo: input.repo,
      userId: input.creds.userId,
      source: input.linkedProjectOwner,
      state,
    });
  }

  return {
    response: NextResponse.json(
      { error: input.createContextResult.error },
      { status: input.createContextResult.status }
    ),
  };
}

async function validateSandboxProjectAccessOrResponse(input: {
  deps: SandboxPostDeps;
  creds: SandboxServiceCredentials;
  repo: SandboxRepoRecord;
  linkedProjectOwner: ReturnType<typeof resolveBillingLinkedProjectOwner>;
  linkedProject: ReturnType<typeof resolveBillingLinkedProjectSelection>;
  createContext: ResolvedSandboxCreateContext;
}): Promise<SandboxCreateContextResolution> {
  const access = await input.deps.validateVercelProjectAccess({
    authMode:
      input.createContext.ownership.credentialSource === "user"
        ? "personal"
        : "platform",
    vercelToken: input.createContext.credentials.vercelToken,
    teamId: input.createContext.credentials.vercelTeamId,
    projectId: input.createContext.credentials.vercelProjectId,
  });

  if (access.ok) {
    return { createContext: input.createContext };
  }

  if (input.createContext.ownership.credentialSource === "platform") {
    console.error("[sandbox/launch] hosted Vercel project preflight failed", {
      code: access.error.code,
      status: access.error.status,
    });
    return {
      response: NextResponse.json(
        {
          error:
            "Hosted sandbox service is temporarily unavailable. Please try again shortly.",
          code: "SANDBOX_SERVICE_UNAVAILABLE",
        },
        { status: 503 }
      ),
    };
  }

  if (shouldPersistLinkedProjectAccessFailure(access.error.code)) {
    const state = buildPersistedVercelLinkStateFromValidation({
      source: input.linkedProjectOwner,
      billingMode: "user_vercel_project",
      projectId: input.linkedProject.projectId,
      personalState: "linked",
      access: { ok: false, code: access.error.code },
      checkedAt: new Date().toISOString(),
    });
    await persistLinkedProjectState(input.deps, {
      repo: input.repo,
      userId: input.creds.userId,
      source: input.linkedProjectOwner,
      state,
    });
  }

  const linkedProjectValidation = deriveVercelLinkedProjectValidation({
    billingMode: input.linkedProject.billingMode,
    source: input.linkedProjectOwner,
    projectId: input.linkedProject.projectId,
    personalState: "linked",
    access: { ok: false, code: access.error.code },
  });

  return {
    response: NextResponse.json(
      {
        error:
          linkedProjectValidation?.message ||
          "The linked Vercel billing project is missing or inaccessible.",
        code: "VERCEL_LINKED_PROJECT_INVALID",
        linkedProjectValidation,
      },
      { status: 400 }
    ),
  };
}

async function resolveSandboxCreateContextOrResponse(input: {
  deps: SandboxPostDeps;
  creds: SandboxServiceCredentials;
  repo: SandboxRepoRecord;
  workspace: ReturnType<typeof toWorkspace>;
  linkedProjectOwner: ReturnType<typeof resolveBillingLinkedProjectOwner>;
  linkedProject: ReturnType<typeof resolveBillingLinkedProjectSelection>;
}): Promise<SandboxCreateContextResolution> {
  const createContextResult = await resolveSandboxCreateContext(
    {
      sandboxCredentials: input.creds,
      workspaceBillingModeInput: input.workspace?.sandbox_billing_mode,
      repoBillingModeOverrideInput: input.repo.sandbox_billing_mode_override,
      repoLinkedProjectId: input.repo.vercel_project_id,
      repoLinkedTeamId: input.repo.vercel_team_id,
      workspaceLinkedProjectId: input.workspace?.sandbox_vercel_project_id,
      workspaceLinkedTeamId: input.workspace?.sandbox_vercel_team_id,
      accountLinkedProjectId: input.creds.accountDefaultVercelProjectId,
      accountLinkedTeamId: input.creds.accountDefaultVercelTeamId,
      includeAi: true,
    },
    {
      resolveSandboxAiAccess: input.deps.resolveSandboxAiAccess,
    }
  );

  if (!createContextResult.ok) {
    return handleSandboxCreateContextFailure({
      deps: input.deps,
      creds: input.creds,
      repo: input.repo,
      linkedProjectOwner: input.linkedProjectOwner,
      linkedProject: input.linkedProject,
      createContextResult,
    });
  }

  return validateSandboxProjectAccessOrResponse({
    deps: input.deps,
    creds: input.creds,
    repo: input.repo,
    linkedProjectOwner: input.linkedProjectOwner,
    linkedProject: input.linkedProject,
    createContext: createContextResult.context,
  });
}

async function loadSandboxLaunchRepoAccess(input: {
  deps: SandboxPostDeps;
  creds: SandboxServiceCredentials;
  repoId: string;
  productTeamId: string | null;
}): Promise<SandboxRepoAccessResolution> {
  const { repo, githubToken } =
    await input.deps.getOwnedRepoWithGithubAccessToken(
      input.repoId,
      input.creds.userId,
      {
        select: SANDBOX_POST_REPO_SELECT,
        productTeamId: input.productTeamId,
      }
    );

  if (!repo) {
    return {
      response: NextResponse.json({ error: "Repo not found" }, { status: 404 }),
    };
  }

  if (!githubToken) {
    return {
      response: NextResponse.json(
        { error: "Connect GitHub account first" },
        { status: 400 }
      ),
    };
  }

  return { repo, githubToken };
}

function resolveSandboxLaunchRequestOrResponse(input: {
  requestBody: SandboxLaunchRequestInput;
  repoDefaultBranch: string | null;
}): SandboxLaunchRequestResolution {
  const launchRequest = resolveSandboxLaunchRequest({
    body: input.requestBody,
    repoDefaultBranch: input.repoDefaultBranch,
  });

  if (!launchRequest.ok) {
    return {
      response: NextResponse.json(
        { error: launchRequest.error },
        { status: 400 }
      ),
    };
  }

  return { launchRequest: launchRequest.value };
}

function resolveSandboxLaunchRepoIdOrResponse(
  requestBody: SandboxLaunchRequestInput
): SandboxRouteResponseResult | { repoId: string } {
  if (!requestBody.repoId) {
    return {
      response: NextResponse.json(
        { error: "repoId required" },
        { status: 400 }
      ),
    };
  }

  return { repoId: requestBody.repoId };
}

async function resolveSandboxLaunchRuntimePreparation(input: {
  repo: SandboxRepoRecord;
  githubToken: string;
  launchRequest: ResolvedSandboxLaunchRequest;
  userId: string;
  productTeamId: string | null;
  /**
   * Pre-computed launch-time path so this helper and the surrounding
   * SandboxLaunchPreparation share a single source of truth. Avoids two
   * independent calls to resolveLaunchRootDirectory drifting if either
   * site's logic ever changes.
   */
  effectiveRootDirectory: string | null;
}): Promise<SandboxLaunchRuntimePreparation> {
  const configuredDevPort = resolveConfiguredDevPort(
    input.repo.dev_port,
    input.repo.dev_port_auto
  );
  const cloneRevision = input.launchRequest.createBranch
    ? input.launchRequest.baseBranch
    : input.launchRequest.workingBranch;
  const allowSnapshotRestore =
    !input.launchRequest.createBranch &&
    input.launchRequest.workingBranch === input.launchRequest.baseBranch;
  // Detect runtime from the workspace the sandbox will actually boot in,
  // not the repo's persistent default. Otherwise a monorepo user who
  // launches at apps/admin can have the runtime sniffed from apps/web's
  // package.json and end up with the wrong Node/Deno major version.
  const runtime: SandboxRuntime =
    input.repo.runtime ||
    (await detectRuntimeFromGithub(
      input.repo.full_name,
      input.githubToken,
      cloneRevision,
      input.effectiveRootDirectory
    ));

  const sandboxSource = await resolveSandboxSourceForLaunch({
    repo: input.repo,
    launchRequest: input.launchRequest,
    githubToken: input.githubToken,
    userId: input.userId,
    productTeamId: input.productTeamId,
    effectiveRootDirectory: input.effectiveRootDirectory,
  });

  return {
    configuredDevPort,
    cloneRevision,
    allowSnapshotRestore,
    runtime,
    healthCheckOptions: {
      treatRoot404AsReady: previewAllowsRoot404({ runtime }),
    },
    sandboxSource,
  };
}

async function resolveSandboxSourceForLaunch(input: {
  repo: SandboxRepoRecord;
  launchRequest: ResolvedSandboxLaunchRequest;
  githubToken: string;
  userId: string;
  productTeamId: string | null;
  effectiveRootDirectory: string | null;
}): Promise<SandboxSource> {
  let fastSpawnEnabled: boolean;
  try {
    const access = await loadUserPlatformAccess(
      input.userId,
      input.productTeamId
    );
    fastSpawnEnabled = Boolean(access.allowPlatformSandbox);
  } catch (error) {
    console.warn(
      "[sandbox/launch] platform access lookup failed; defaulting fast-spawn off",
      error
    );
    fastSpawnEnabled = false;
  }

  const snapshotLockfileHash =
    (
      input.repo as SandboxRepoRecord & {
        snapshot_lockfile_hash?: string | null;
      }
    ).snapshot_lockfile_hash ?? null;

  return pickSandboxSource({
    repo: {
      id: input.repo.id,
      full_name: input.repo.full_name,
      default_branch: input.repo.default_branch,
      root_directory: input.repo.root_directory,
      snapshot_id: input.repo.snapshot_id,
      snapshot_lockfile_hash: snapshotLockfileHash,
    },
    baseBranch: input.launchRequest.baseBranch,
    workingBranch: input.launchRequest.workingBranch,
    createBranch: input.launchRequest.createBranch,
    githubToken: input.githubToken,
    fastSpawnEnabled,
    restoreSnapshotIdRequested: input.launchRequest.restoreSnapshotId,
    // Pass the launch-time path so pickSandboxSource can refuse to
    // restore a baseline snapshot built at a different workspace.
    effectiveRootDirectory: input.effectiveRootDirectory,
  });
}

async function prepareSandboxLaunch(input: {
  deps: SandboxPostDeps;
  request: Request;
  creds: SandboxServiceCredentials;
  productTeamId: string | null;
}): Promise<SandboxLaunchPreparationResult> {
  const requestBody = (await input.request.json()) as SandboxLaunchRequestInput;
  const repoId = resolveSandboxLaunchRepoIdOrResponse(requestBody);
  if ("response" in repoId) return repoId;

  const repoAccess = await loadSandboxLaunchRepoAccess({
    deps: input.deps,
    creds: input.creds,
    repoId: repoId.repoId,
    productTeamId: input.productTeamId,
  });
  if ("response" in repoAccess) return repoAccess;

  const launchRequest = resolveSandboxLaunchRequestOrResponse({
    requestBody,
    repoDefaultBranch: repoAccess.repo.default_branch,
  });
  if ("response" in launchRequest) return launchRequest;

  const workspace = toWorkspace(repoAccess.repo.workspace);
  const effectiveSandboxTimeoutMs = resolveEffectiveSandboxTimeoutMs({
    repoTimeoutMs: repoAccess.repo.sandbox_timeout_ms,
    workspaceTimeoutMs: workspace?.sandbox_timeout_ms,
  });
  const linkedProjectOwner = resolveBillingLinkedProjectOwner({
    workspaceBillingModeInput: workspace?.sandbox_billing_mode,
    repoBillingModeOverrideInput: repoAccess.repo.sandbox_billing_mode_override,
    repoLinkedProjectId: repoAccess.repo.vercel_project_id,
    workspaceLinkedProjectId: workspace?.sandbox_vercel_project_id,
    accountLinkedProjectId: input.creds.accountDefaultVercelProjectId,
  });
  const linkedProject = resolveBillingLinkedProjectSelection({
    workspaceBillingModeInput: workspace?.sandbox_billing_mode,
    repoBillingModeOverrideInput: repoAccess.repo.sandbox_billing_mode_override,
    repoLinkedProjectId: repoAccess.repo.vercel_project_id,
    repoLinkedTeamId: repoAccess.repo.vercel_team_id,
    workspaceLinkedProjectId: workspace?.sandbox_vercel_project_id,
    workspaceLinkedTeamId: workspace?.sandbox_vercel_team_id,
    accountLinkedProjectId: input.creds.accountDefaultVercelProjectId,
    accountLinkedTeamId: input.creds.accountDefaultVercelTeamId,
  });
  const createContextResult = await resolveSandboxCreateContextOrResponse({
    deps: input.deps,
    creds: input.creds,
    repo: repoAccess.repo,
    workspace,
    linkedProjectOwner,
    linkedProject,
  });
  if ("response" in createContextResult) {
    return createContextResult;
  }

  // Compute the launch-time path once and pass it to every downstream
  // step. Both the runtime detector and the SandboxLaunchPreparation
  // object need it, and computing twice would risk a future divergence
  // if either call site's logic ever changes shape.
  const effectiveRootDirectory = resolveLaunchRootDirectory({
    request: launchRequest.launchRequest,
    repo: repoAccess.repo,
  });

  const runtimePreparation = await resolveSandboxLaunchRuntimePreparation({
    repo: repoAccess.repo,
    githubToken: repoAccess.githubToken,
    launchRequest: launchRequest.launchRequest,
    userId: input.creds.userId,
    productTeamId: input.productTeamId,
    effectiveRootDirectory,
  });

  return {
    launch: {
      creds: input.creds,
      productTeamId: input.productTeamId,
      actorUserId: input.creds.userId,
      repo: repoAccess.repo,
      githubToken: repoAccess.githubToken,
      launchRequest: launchRequest.launchRequest,
      repoId: launchRequest.launchRequest.repoId,
      effectiveRootDirectory,
      linkedProjectOwner,
      linkedProject,
      createContext: createContextResult.createContext,
      effectiveSandboxTimeoutMs,
      ...runtimePreparation,
    } satisfies SandboxLaunchPreparation,
  };
}

async function maybeReturnExistingSandboxResponse(
  deps: SandboxPostDeps,
  launch: SandboxLaunchPreparation
) {
  const existing = await deps.getActiveSandboxForRepo(
    launch.repoId,
    launch.creds.userId,
    launch.launchRequest.workingBranch,
    launch.effectiveRootDirectory,
    launch.productTeamId
  );
  if (!existing) return null;

  const existingState = await deps.resolveActiveSandboxState({
    sandboxCredentials: launch.creds,
    record: existing,
  });

  if (existingState.kind === "unresolvable") {
    console.warn(
      `[sandbox/launch] Retiring unresolvable active record ${existing.id} (${existing.sandbox_id}) to unblock launch`
    );
    // Displacement is the consequence of an explicit user launch, so
    // "manual" reads more honestly in the UI than "unknown".
    const retired = await deps.stopSandboxRecord(existing.id, {
      expectedSandboxId: existing.sandbox_id,
      stopReason: "manual",
    });
    if (!retired) {
      // Retry without expectedSandboxId: a concurrent write may have
      // changed sandbox_id between the read above and this update, so
      // relax the guard rather than abandon the retirement.
      await deps.stopSandboxRecord(existing.id, { stopReason: "manual" });
    }
  }

  if (existingState.kind === "running" || existingState.kind === "pending") {
    return NextResponse.json({ sandbox: toSandboxClientRecord(existing) });
  }

  if (existingState.kind === "stopped") {
    await deps.stopSandboxRecord(existing.id, {
      expectedSandboxId: existing.sandbox_id,
      stopReason: "vm_gone",
    });
    return null;
  }

  if (existingState.kind === "stale_pending") {
    await deps.stopSandboxRecord(existing.id, {
      expectedSandboxId: existing.sandbox_id,
      fromStatuses: ["creating", "installing"],
      stopReason: "stuck_boot",
    });
    return null;
  }

  if (existing.sandbox_id && existing.sandbox_id !== "pending") {
    // Last-resort retirement: at this point the VM was neither usable nor
    // classified as a stale boot/missing VM, so preserve that uncertainty.
    await deps.stopSandboxRecord(existing.id, {
      expectedSandboxId: existing.sandbox_id,
      stopReason: "unknown",
    });
  }

  return null;
}

// Runs only when maybeReturnExistingSandboxResponse returned null (no usable
// active DB record). If the DB had a record we already short-circuited; this
// guard exists to recover orphaned Vercel sandboxes that have no DB row, or
// records that fall outside the active-status filter (e.g. paused/stopped
// rows whose Vercel sandbox is still live under the same deterministic name).
//
// The boot-limit claim is taken before this runs so the claim id can be
// attached to a freshly adopted record (so adoption participates in active
// counts) and so the claim can be released cleanly when we end up resuming
// an existing record without booting anything new.
async function maybeReturnNameCollisionResponse(
  deps: SandboxPostDeps,
  launch: SandboxLaunchPreparation,
  limitClaimId: string | null
) {
  const sandboxName = buildSandboxName({
    repoId: launch.repoId,
    workingBranch: launch.launchRequest.workingBranch,
    userId: launch.creds.userId,
    productTeamId: launch.productTeamId,
    rootDirectory: launch.effectiveRootDirectory,
  });
  const collision = await deps.resolveNameCollision({
    name: sandboxName,
    repoId: launch.repoId,
    userId: launch.creds.userId,
    productTeamId: launch.productTeamId,
    actorUserId: launch.actorUserId,
    workingBranch: launch.launchRequest.workingBranch,
    baseBranch: launch.launchRequest.baseBranch,
    rootDirectory: launch.effectiveRootDirectory,
    runtime: launch.runtime,
    credentials: launch.createContext.credentials,
    billingSource: launch.createContext.ownership.billingSource,
    billingTeamId: launch.createContext.credentials.vercelTeamId,
    billingProjectId: launch.createContext.credentials.vercelProjectId,
    limitClaimId,
  });

  if (collision.kind === "create") return null;

  // Both resume and adopt short-circuit without booting a new sandbox, so
  // the freshly minted claim has no boot to amortize. Resume reuses an
  // existing active record; adopt just inserted a row with status='running'
  // (which already counts in v_active_sandboxes via the SQL claim helper).
  // In both cases the in-flight limit_events row should be released so it
  // does not linger in v_provisional_boots until the TTL expires.
  await releaseSandboxBootLimitClaim(launch.creds.userId, limitClaimId);

  return NextResponse.json({ sandbox: collision.record });
}

async function claimSandboxBootLimitOrResponse(
  deps: SandboxPostDeps,
  launch: SandboxLaunchPreparation
): Promise<SandboxBootLimitClaimResolution> {
  const limitDecision = await deps.enforceSandboxBootLimits({
    userId: launch.creds.userId,
    repoId: launch.repoId,
  });
  if (!limitDecision.allowed) {
    return { response: buildLimitResponse(limitDecision) };
  }
  return { limitClaimId: limitDecision.claimId ?? null };
}

async function insertPendingSandboxLaunchRecord(input: {
  deps: SandboxPostDeps;
  launch: SandboxLaunchPreparation;
  limitClaimId: string | null;
}): Promise<PendingSandboxLaunchRecordResult> {
  const bootStartedAt = new Date().toISOString();
  const { data: record, error: insertErr } = await supabaseAdmin
    .from("sandboxes")
    .insert({
      user_id: input.launch.creds.userId,
      product_team_id: input.launch.productTeamId,
      actor_user_id: input.launch.actorUserId,
      repo_id: input.launch.repoId,
      sandbox_id: "pending",
      base_branch: input.launch.launchRequest.baseBranch,
      working_branch: input.launch.launchRequest.workingBranch,
      limit_claim_id: input.limitClaimId,
      status: "creating",
      runtime: input.launch.runtime,
      billing_source: input.launch.createContext.ownership.billingSource,
      billing_team_id: input.launch.createContext.credentials.vercelTeamId,
      billing_project_id:
        input.launch.createContext.credentials.vercelProjectId,
      vercel_team_id: input.launch.createContext.credentials.vercelTeamId,
      vercel_project_id: input.launch.createContext.credentials.vercelProjectId,
      sandbox_billing_target: input.launch.createContext.credentials
        .vercelTeamId
        ? "team"
        : "personal",
      health_status: "starting",
      boot_attempts: 1,
      last_boot_started_at: bootStartedAt,
      last_boot_completed_at: null,
      last_boot_error: null,
      last_preview_http_status: null,
      last_preview_error: null,
      install_log: "",
      dev_log: "",
      persistent: resolvePendingSandboxPersistenceFlag(),
      // effectiveRootDirectory is already string | null; use it for both
      // columns so terminal_cwd and root_directory cannot drift if the
      // upstream resolver ever changes shape (e.g. starts producing
      // empty strings, which `|| null` would silently coerce).
      terminal_cwd: input.launch.effectiveRootDirectory,
      root_directory: input.launch.effectiveRootDirectory,
    })
    .select(SANDBOX_STREAM_SELECT)
    .single();

  if (!insertErr && record) {
    return {
      record: record as SandboxRecordRow,
      limitClaimId: input.limitClaimId,
    } satisfies PendingSandboxLaunchRecord;
  }

  if (insertErr?.code === "23505") {
    const concurrent = await input.deps.getActiveSandboxForRepo(
      input.launch.repoId,
      input.launch.creds.userId,
      input.launch.launchRequest.workingBranch,
      input.launch.effectiveRootDirectory,
      input.launch.productTeamId
    );
    if (concurrent) {
      await releaseSandboxBootLimitClaim(
        input.launch.creds.userId,
        input.limitClaimId
      );
      return {
        response: NextResponse.json({
          sandbox: toSandboxClientRecord(concurrent),
        }),
      };
    }
  }

  await releaseSandboxBootLimitClaim(
    input.launch.creds.userId,
    input.limitClaimId
  );
  return {
    response: NextResponse.json(
      { error: insertErr?.message || "Failed to create record" },
      { status: 500 }
    ),
  };
}

function createInitialSandboxLaunchState(
  record: SandboxRecordRow,
  repo: SandboxRepoRecord
): SandboxLaunchState {
  return {
    sandbox: null,
    previewUrl: null,
    restoredFromSnapshot: false,
    restoredFromBaselineSnapshot: false,
    shouldQueueDeferredSnapshot: repo.snapshot_id == null,
    streamSandboxRecord: record,
  };
}

async function resolveSandboxLaunchEnvironment(input: {
  launch: SandboxLaunchPreparation;
  emit: (event: SandboxEvent) => void;
}): Promise<SandboxLaunchEnvironment> {
  const envResolution = await resolveRepoSandboxEnv({
    repo: input.launch.repo,
    userId: input.launch.creds.userId,
  });
  if (envResolution.sync.warning) {
    input.emit({ type: "warning", message: envResolution.sync.warning });
  }

  return {
    envResolution,
    networkPolicy:
      "ai" in input.launch.createContext
        ? input.launch.createContext.ai.networkPolicy
        : undefined,
  };
}

function resolveEffectiveSnapshotId(launch: SandboxLaunchPreparation) {
  if (launch.launchRequest.restoreSnapshotId) {
    return launch.launchRequest.restoreSnapshotId;
  }
  if (launch.sandboxSource.kind === "snapshot") {
    return launch.sandboxSource.snapshotId;
  }
  if (launch.allowSnapshotRestore) {
    return launch.repo.snapshot_id;
  }
  return null;
}

function isBaselineSnapshotLaunch(launch: SandboxLaunchPreparation) {
  return (
    !launch.launchRequest.restoreSnapshotId &&
    launch.sandboxSource.kind === "snapshot"
  );
}

function resolveSnapshotCredentials(launch: SandboxLaunchPreparation) {
  if (!launch.launchRequest.restoreSnapshotProjectId) {
    return launch.createContext.credentials;
  }

  return {
    vercelToken: launch.createContext.credentials.vercelToken,
    vercelTeamId:
      launch.launchRequest.restoreSnapshotTeamId ??
      launch.createContext.credentials.vercelTeamId,
    vercelProjectId: launch.launchRequest.restoreSnapshotProjectId,
  };
}

async function restoreSandboxFromSnapshotIfAvailable(input: {
  deps: SandboxPostDeps;
  launch: SandboxLaunchPreparation;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
  sandboxRecordId: string;
}) {
  const effectiveSnapshotId = resolveEffectiveSnapshotId(input.launch);
  if (!effectiveSnapshotId) {
    return {
      sandbox: null,
      restoredFromSnapshot: false,
      restoredFromBaselineSnapshot: false,
      shouldQueueDeferredSnapshot: input.launch.repo.snapshot_id == null,
    };
  }

  try {
    input.emit({
      type: "snapshot_restore",
      snapshotId: effectiveSnapshotId,
    });
    const snapshotCredentials = resolveSnapshotCredentials(input.launch);
    const sandbox = await input.deps.createSandboxFromSnapshot({
      vercelToken: snapshotCredentials.vercelToken,
      vercelTeamId: snapshotCredentials.vercelTeamId,
      vercelProjectId: snapshotCredentials.vercelProjectId,
      snapshotId: effectiveSnapshotId,
      runtime: input.launch.runtime,
      devPort: input.launch.configuredDevPort,
      timeoutMs: input.launch.effectiveSandboxTimeoutMs,
      envVars: input.environment.envResolution.envVars,
      networkPolicy: input.environment.networkPolicy,
      onResume: createSandboxBillingOnResume(input.sandboxRecordId),
    });
    return {
      sandbox,
      restoredFromSnapshot: true,
      restoredFromBaselineSnapshot: isBaselineSnapshotLaunch(input.launch),
      shouldQueueDeferredSnapshot: input.launch.repo.snapshot_id == null,
    };
  } catch (snapshotErr) {
    console.warn(
      "[sandbox/create] Snapshot restore failed, falling back to git:",
      snapshotErr
    );
    if (
      effectiveSnapshotId === input.launch.repo.snapshot_id &&
      input.launch.repo.snapshot_id
    ) {
      await clearRepoSnapshotIfCurrent(
        input.launch.repoId,
        input.launch.repo.snapshot_id
      );
    }
    return {
      sandbox: null,
      restoredFromSnapshot: false,
      restoredFromBaselineSnapshot: false,
      shouldQueueDeferredSnapshot: true,
    };
  }
}

async function provisionSandboxForLaunch(input: {
  deps: SandboxPostDeps;
  launch: SandboxLaunchPreparation;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
  sandboxName?: string;
  sandboxRecordId: string;
}) {
  const restored = await restoreSandboxFromSnapshotIfAvailable(input);
  if (restored.sandbox) {
    return restored;
  }

  const sandbox = await input.deps.createSandboxForRepo({
    vercelToken: input.launch.createContext.credentials.vercelToken,
    vercelTeamId: input.launch.createContext.credentials.vercelTeamId,
    vercelProjectId: input.launch.createContext.credentials.vercelProjectId,
    githubToken: input.launch.githubToken,
    repoFullName: input.launch.repo.full_name,
    branch: input.launch.cloneRevision,
    runtime: input.launch.runtime,
    devPort: input.launch.configuredDevPort,
    timeoutMs: input.launch.effectiveSandboxTimeoutMs,
    envVars: input.environment.envResolution.envVars,
    networkPolicy: input.environment.networkPolicy,
    ...(input.sandboxName ? { name: input.sandboxName } : {}),
    onResume: createSandboxBillingOnResume(input.sandboxRecordId),
  });

  return {
    sandbox,
    restoredFromSnapshot: false,
    restoredFromBaselineSnapshot: false,
    shouldQueueDeferredSnapshot: restored.shouldQueueDeferredSnapshot,
  };
}

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function configureSandboxGitAccess(input: {
  sandbox: SandboxInstance;
  githubToken: string;
  userId: string;
}) {
  try {
    const gitAuthor = await resolveSandboxGitAuthor(input.userId);
    await input.sandbox.writeFiles([
      {
        path: ".git-credentials",
        content: Buffer.from(
          `https://x-access-token:${input.githubToken}@github.com\n`
        ),
      },
    ]);
    const credSetup = await input.sandbox.runCommand({
      cmd: "sh",
      args: [
        "-lc",
        [
          "mv .git-credentials ~/ 2>/dev/null; chmod 600 ~/.git-credentials",
          "git config --global credential.helper store",
          `git config --global user.name ${shellQuoteSingle(gitAuthor.name)}`,
          `git config --global user.email ${shellQuoteSingle(gitAuthor.email)}`,
        ].join(" && "),
      ],
    });
    if (credSetup.exitCode !== 0) {
      console.warn(
        `[sandbox/create] Git credential setup failed, exitCode=${credSetup.exitCode}`
      );
    }
  } catch (credErr) {
    console.warn("[sandbox/create] Git credential setup error:", credErr);
  }
}

async function stopSandboxInstanceBestEffort(sandbox: SandboxInstance | null) {
  if (!sandbox) return;
  try {
    await sandbox.stop();
  } catch {
    /* best-effort */
  }
}

async function transitionSandboxRecordToInstalling(input: {
  recordId: string;
  sandboxId: string;
  sandbox: SandboxInstance | null;
}) {
  const installing = await updateSandboxRecord(
    input.recordId,
    buildSandboxInstallingRecordUpdates(input),
    {
      fromStatuses: "creating",
      select: SANDBOX_STREAM_SELECT,
    }
  );

  return installing as SandboxRecordRow | null;
}

export function buildSandboxInstallingRecordUpdates(input: {
  sandboxId: string;
  sandbox: unknown;
}) {
  return {
    sandbox_id: input.sandboxId,
    status: "installing",
    persistent: readSandboxPersistentFlag(input.sandbox) ?? false,
  };
}

export function resolvePendingSandboxPersistenceFlag() {
  return !persistentSandboxesDisabledByEnv();
}

async function queueSandboxReadinessReconciliationWarning(input: {
  deps: SandboxPostDeps;
  recordId: string;
  sandboxId: string;
  emit: (event: SandboxEvent) => void;
}) {
  try {
    const readinessRun = await input.deps.startSandboxReadinessReconciliation({
      sandboxRecordId: input.recordId,
      expectedSandboxId: input.sandboxId,
      source: "launch",
    });
    if (
      !readinessRun.queued &&
      readinessRun.reason !== "trigger_not_configured"
    ) {
      input.emit({
        type: "warning",
        message: "Sandbox readiness reconciliation could not be queued.",
      });
    }
  } catch (error) {
    console.error(
      "[sandbox/create] Failed to queue sandbox readiness reconciliation",
      error
    );
    input.emit({
      type: "warning",
      message: "Sandbox readiness reconciliation could not be queued.",
    });
  }
}

function createSandboxBootstrapStream(input: {
  state: SandboxLaunchState;
  sandbox: SandboxInstance;
  launch: SandboxLaunchPreparation;
  environment: SandboxLaunchEnvironment;
}) {
  if (
    input.state.restoredFromBaselineSnapshot &&
    input.launch.sandboxSource.kind === "snapshot"
  ) {
    return bootstrapFromBaselineSnapshotStreaming(input.sandbox, {
      rootDirectory: input.launch.effectiveRootDirectory,
      installCommand: input.launch.repo.install_command,
      devCommand: input.launch.repo.dev_command,
      devPort: input.launch.configuredDevPort,
      envVars: input.environment.envResolution.envVars,
      envSyncMode: input.environment.envResolution.sync.mode,
      linkedVercelProject: getRepoLinkedVercelProject(input.launch.repo),
      runtime: input.launch.runtime,
      baseBranch: input.launch.launchRequest.baseBranch,
      workingBranch: input.launch.launchRequest.workingBranch,
      createBranch: input.launch.launchRequest.createBranch,
      expectedLockfileHash: input.launch.sandboxSource.expectedLockfileHash,
    });
  }

  if (input.state.restoredFromSnapshot) {
    return bootstrapFromSnapshotStreaming(input.sandbox, {
      rootDirectory: input.launch.effectiveRootDirectory,
      devCommand: input.launch.repo.dev_command,
      devPort: input.launch.configuredDevPort,
      envVars: input.environment.envResolution.envVars,
      envSyncMode: input.environment.envResolution.sync.mode,
      linkedVercelProject: getRepoLinkedVercelProject(input.launch.repo),
      runtime: input.launch.runtime,
    });
  }

  return bootstrapSandboxStreaming(input.sandbox, {
    rootDirectory: input.launch.effectiveRootDirectory,
    installCommand: input.launch.repo.install_command,
    devCommand: input.launch.repo.dev_command,
    devPort: input.launch.configuredDevPort,
    envVars: input.environment.envResolution.envVars,
    envSyncMode: input.environment.envResolution.sync.mode,
    linkedVercelProject: getRepoLinkedVercelProject(input.launch.repo),
    runtime: input.launch.runtime,
  });
}

function emitStreamSandboxStatus(
  emit: (event: SandboxEvent) => void,
  status: Extract<SandboxEvent, { type: "status" }>["status"],
  record: SandboxRecordRow | SandboxRecord
) {
  emit({
    type: "status",
    status,
    sandbox: toStreamStatusSandboxRecord(record),
  });
}

async function maybeQueueDeferredSnapshotWarmup(input: {
  deps: SandboxPostDeps;
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  emit: (event: SandboxEvent) => void;
}) {
  if (
    !input.state.shouldQueueDeferredSnapshot ||
    !shouldQueueSnapshotWarmupOnSandboxLaunch()
  ) {
    return;
  }

  try {
    const snapshotWarmupRun = await input.deps.startDeferredRepoSnapshotBuild({
      repoId: input.launch.repo.id,
    });
    const snapshotWarmupSummary =
      summarizeDeferredSnapshotWarmupQueueResult(snapshotWarmupRun);
    const snapshotWarmupLogContext = {
      repoId: input.launch.repo.id,
      ...snapshotWarmupSummary.details,
    };

    if (snapshotWarmupSummary.logLevel === "warn") {
      console.warn(snapshotWarmupSummary.logMessage, snapshotWarmupLogContext);
    } else {
      console.info(snapshotWarmupSummary.logMessage, snapshotWarmupLogContext);
    }

    if (snapshotWarmupSummary.warningMessage) {
      input.emit({
        type: "warning",
        message: snapshotWarmupSummary.warningMessage,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown snapshot queue error";
    console.warn("[sandbox/create] Failed to queue deferred snapshot build", {
      repoId: input.launch.repo.id,
      error: message,
    });
    input.emit({
      type: "warning",
      message: "Automatic snapshot warmup could not be queued.",
    });
  }
}

async function activateRunningSandboxRecord(input: {
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  emit: (event: SandboxEvent) => void;
}) {
  const timestamp = new Date().toISOString();
  const previewHealth = input.state.previewUrl
    ? await checkSandboxHealth(
        input.state.previewUrl,
        {
          sandboxId: input.state.sandbox!.name,
          token: input.launch.createContext.credentials.vercelToken,
          projectId: input.launch.createContext.credentials.vercelProjectId,
          teamId: input.launch.createContext.credentials.vercelTeamId,
        },
        input.launch.healthCheckOptions
      )
    : {
        status: "not_available" as const,
        message: "No preview URL",
        statusCode: undefined,
      };
  const sandboxStatus =
    previewHealth.status === "stopped" ? "stopped" : "running";

  const activated = await updateSandboxRecord(
    input.state.streamSandboxRecord.id,
    {
      status: sandboxStatus,
      preview_url: input.state.previewUrl,
      health_status: previewHealth.status,
      last_health_check_at: timestamp,
      last_active_at: timestamp,
      last_preview_http_status: previewHealth.statusCode ?? null,
      last_preview_error:
        previewHealth.status === "running" ||
        previewHealth.status === "idle_warning"
          ? null
          : previewHealth.message,
      last_boot_completed_at: timestamp,
      last_boot_error: null,
      error: null,
    },
    {
      expectedSandboxId: input.state.sandbox!.name,
      fromStatuses: ["creating", "installing", "running"],
      select: SANDBOX_STREAM_SELECT,
    }
  );

  if (!activated) {
    await input.deps
      .prepareSandboxBillingClose(input.state.streamSandboxRecord.id)
      .catch(() => null);
    await stopSandboxInstanceBestEffort(input.state.sandbox);
    input.emit({
      type: "error",
      message: "Sandbox creation was cancelled before it became ready.",
      phase: "bootstrap",
    });
    return false;
  }

  input.state.streamSandboxRecord = activated as unknown as SandboxRecordRow;
  const readySandbox = toStreamSandboxRecord(input.state.streamSandboxRecord);
  const { status: readyStatus } = readySandbox.runtime_summary;
  emitStreamSandboxStatus(
    input.emit,
    readyStatus as Extract<SandboxEvent, { type: "status" }>["status"],
    readySandbox
  );
  input.emit({ type: "ready", sandbox: readySandbox });

  if (sandboxStatus === "running") {
    await maybeQueueDeferredSnapshotWarmup(input);
  }

  return true;
}

async function consumeSandboxBootstrapStream(input: {
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
}) {
  try {
    await consumeSandboxBootstrapStreamOnce(input);
  } catch (err) {
    if (
      err instanceof BaselineSnapshotRestoreError &&
      input.state.restoredFromBaselineSnapshot
    ) {
      console.warn(
        `[sandbox/launch] Baseline restore failed (phase=${err.phase}): ${err.message}. Falling back to git clone.`
      );
      input.emit({
        type: "warning",
        message:
          "Baseline snapshot could not be applied cleanly; retrying with a fresh git clone.",
      });
      await fallbackFromBaselineToGit(input);
      await consumeSandboxBootstrapStreamOnce(input);
      return;
    }
    throw err;
  }
}

async function fallbackFromBaselineToGit(input: {
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
}) {
  await input.deps
    .prepareSandboxBillingClose(input.state.streamSandboxRecord.id)
    .catch(() => null);
  await stopSandboxInstanceBestEffort(input.state.sandbox);
  if (input.launch.repo.snapshot_id) {
    await clearRepoSnapshotIfCurrent(
      input.launch.repoId,
      input.launch.repo.snapshot_id
    );
  }
  const fresh = await input.deps.createSandboxForRepo({
    vercelToken: input.launch.createContext.credentials.vercelToken,
    vercelTeamId: input.launch.createContext.credentials.vercelTeamId,
    vercelProjectId: input.launch.createContext.credentials.vercelProjectId,
    githubToken: input.launch.githubToken,
    repoFullName: input.launch.repo.full_name,
    branch: input.launch.cloneRevision,
    runtime: input.launch.runtime,
    devPort: input.launch.configuredDevPort,
    timeoutMs: input.launch.effectiveSandboxTimeoutMs,
    envVars: input.environment.envResolution.envVars,
    networkPolicy: input.environment.networkPolicy,
    // Baseline→git fallback still reuses the record's name so the user
    // sees a stable sandbox identifier across the recovery path.
    name: buildSandboxName({
      repoId: input.launch.repoId,
      workingBranch: input.launch.launchRequest.workingBranch,
      recordId: input.state.streamSandboxRecord.id,
      userId: input.launch.creds.userId,
      productTeamId: input.launch.productTeamId,
      rootDirectory: input.launch.effectiveRootDirectory,
    }),
    onResume: createSandboxBillingOnResume(input.state.streamSandboxRecord.id),
  });
  input.state.sandbox = fresh;
  input.state.restoredFromSnapshot = false;
  input.state.restoredFromBaselineSnapshot = false;
  await input.deps.requireSandboxBillingSession(
    input.state.streamSandboxRecord.id,
    fresh
  );
  await configureSandboxGitAccess({
    sandbox: fresh,
    githubToken: input.launch.githubToken,
    userId: input.launch.creds.userId,
  });
  if (input.launch.launchRequest.createBranch) {
    await createWorkingBranchInSandbox(fresh, {
      ...input.launch.launchRequest,
      // Use the launch-time effective path so the branch is created in
      // the same workspace the dev server will boot at, not the repo's
      // persistent default.
      rootDirectory: input.launch.effectiveRootDirectory,
    });
  }
}

async function consumeSandboxBootstrapStreamOnce(input: {
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
}) {
  const bootstrapStream = createSandboxBootstrapStream({
    state: input.state,
    sandbox: input.state.sandbox!,
    launch: input.launch,
    environment: input.environment,
  });

  for await (const event of bootstrapStream) {
    if (event.type === "warning" || event.type === "log") {
      input.emit(event);
      continue;
    }

    if (event.type === "preview_url") {
      input.state.previewUrl = event.url;
      input.state.streamSandboxRecord = {
        ...input.state.streamSandboxRecord,
        preview_url: event.url,
      };
      input.emit({
        type: "preview_url",
        url: event.url,
        sandbox: toStreamSandboxRecord(input.state.streamSandboxRecord),
      });
      continue;
    }

    if (event.type === "status" && event.status === "installing") {
      input.state.streamSandboxRecord = {
        ...input.state.streamSandboxRecord,
        status: "installing",
      };
      emitStreamSandboxStatus(
        input.emit,
        "installing",
        input.state.streamSandboxRecord
      );
      continue;
    }

    if (event.type === "status" && event.status === "running") {
      const activated = await activateRunningSandboxRecord(input);
      if (!activated) {
        return;
      }
    }
  }
}

export function classifySandboxLaunchFailure(err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown error";
  const apiCode = extractVercelApiErrorCode(err)?.toLowerCase() ?? null;
  const apiDetail = extractVercelApiErrorDetail(err);
  const detailedMessage = apiDetail ? `${message} — ${apiDetail}` : message;
  const apiDetailLower = apiDetail?.toLowerCase() ?? "";

  const sandboxRequestValidationMessage =
    apiCode === "reserved_port"
      ? `Vercel rejected the sandbox request: ${apiDetail}. Change the repo sandbox dev port or dev command to a supported port such as 3000 or 5173.`
      : apiDetailLower.includes("payload too large")
        ? `Vercel rejected the sandbox request: ${apiDetail}. Remove or shorten sandbox env vars before launching.`
        : null;

  const actionableMessage =
    err instanceof SandboxCreateRequestValidationError
      ? err.message
      : /status code (40[13]|410)/i.test(message)
        ? "Sandbox expired or unavailable. Try again."
        : /status code 400/i.test(message)
          ? sandboxRequestValidationMessage ||
            `Vercel rejected the sandbox request${apiDetail ? `: ${apiDetail}` : ""}. Check repo settings — env vars, ports, dev command, or the selected branch.`
          : detailedMessage;

  return {
    message: detailedMessage,
    actionableMessage,
    phase: err instanceof SandboxBootstrapError ? "bootstrap" : "create",
  };
}

async function resolveSandboxLaunchFailurePreviewHealth(input: {
  err: unknown;
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  actionableMessage: string;
}) {
  let healthStatus: "error" | "app_error" | "unreachable" = "error";
  let previewHttpStatus: number | null = null;
  let previewError: string | null = input.actionableMessage;

  if (
    input.state.sandbox &&
    input.err instanceof SandboxBootstrapError &&
    input.err.previewUrl
  ) {
    try {
      const health = await checkSandboxHealth(
        input.err.previewUrl,
        {
          sandboxId: input.state.sandbox.name,
          token: input.launch.createContext.credentials.vercelToken,
          projectId: input.launch.createContext.credentials.vercelProjectId,
          teamId: input.launch.createContext.credentials.vercelTeamId,
        },
        input.launch.healthCheckOptions
      );
      if (health.status === "app_error" || health.status === "unreachable") {
        healthStatus = health.status;
      }
      previewHttpStatus = health.statusCode ?? null;
      previewError = health.message || input.actionableMessage;
    } catch {
      /* keep default bootstrap failure classification */
    }
  }

  return {
    healthStatus,
    previewHttpStatus,
    previewError,
  };
}

async function loadSandboxLaunchFailureDiagnostics(
  launch: SandboxLaunchPreparation
) {
  try {
    return await loadSandboxVercelDiagnostics({
      authMode: (launch.createContext.ownership.credentialSource === "user"
        ? "personal"
        : "platform") as VercelAuthMode,
      vercelToken: launch.createContext.credentials.vercelToken,
      teamId: launch.createContext.credentials.vercelTeamId,
      projectId: launch.createContext.credentials.vercelProjectId,
    });
  } catch (diagnosticsError) {
    console.error(
      "[sandbox/create] Failed to load Vercel deployment diagnostics",
      diagnosticsError
    );
    return null;
  }
}

export function shouldLoadSandboxLaunchFailureDiagnostics(
  state: SandboxLaunchState
) {
  // Before Sandbox.create succeeds, shared-project diagnostics can point at an
  // unrelated app deployment on the linked Vercel project and overwrite the
  // sandbox's own create-time error. Only attach them once a sandbox exists.
  return Boolean(state.sandbox);
}

async function resolveSandboxLaunchFailureState(input: {
  err: unknown;
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
}) {
  const failure = classifySandboxLaunchFailure(input.err);
  const previewState = await resolveSandboxLaunchFailurePreviewHealth({
    err: input.err,
    state: input.state,
    launch: input.launch,
    actionableMessage: failure.actionableMessage,
  });
  const vercelDiagnostics = shouldLoadSandboxLaunchFailureDiagnostics(
    input.state
  )
    ? await loadSandboxLaunchFailureDiagnostics(input.launch)
    : null;
  const previewError =
    vercelDiagnostics?.buildSummary || previewState.previewError;

  return {
    failure,
    healthStatus: previewState.healthStatus,
    previewHttpStatus: previewState.previewHttpStatus,
    previewError,
    vercelDiagnostics,
  };
}

async function handleSandboxLaunchFailure(input: {
  err: unknown;
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  emit: (event: SandboxEvent) => void;
}) {
  const failureState = await resolveSandboxLaunchFailureState(input);

  await input.deps
    .prepareSandboxBillingClose(input.state.streamSandboxRecord.id)
    .catch(() => null);
  await stopSandboxInstanceBestEffort(input.state.sandbox);

  const failed = await updateSandboxRecord(
    input.state.streamSandboxRecord.id,
    {
      status: "error",
      error: failureState.failure.actionableMessage,
      health_status: failureState.healthStatus,
      last_health_check_at: new Date().toISOString(),
      last_preview_http_status: failureState.previewHttpStatus,
      last_preview_error: failureState.previewError,
      last_boot_error: failureState.failure.actionableMessage,
      last_boot_completed_at: null,
      ...(input.err instanceof SandboxBootstrapError && input.err.installLog
        ? { install_log: input.err.installLog }
        : {}),
      ...(input.err instanceof SandboxBootstrapError && input.err.devLog
        ? { dev_log: input.err.devLog }
        : {}),
    },
    {
      expectedSandboxId: input.state.sandbox?.name,
      fromStatuses: ACTIVE_SANDBOX_STATUSES,
      select: SANDBOX_STREAM_SELECT,
    }
  );

  if (failed) {
    input.state.streamSandboxRecord = failed as unknown as SandboxRecordRow;
    const failedSandboxRecord = failureState.vercelDiagnostics
      ? toSandboxClientRecord({
          ...input.state.streamSandboxRecord,
          vercel_diagnostics: failureState.vercelDiagnostics,
        })
      : toStreamSandboxRecord(input.state.streamSandboxRecord);
    input.emit({
      type: "status",
      status: "error",
      sandbox: failedSandboxRecord,
    });
  }

  input.emit({
    type: "error",
    message: failureState.failure.actionableMessage,
    phase: failureState.failure.phase,
  });
}

async function executeSandboxLaunchStream(input: {
  deps: SandboxPostDeps;
  launch: SandboxLaunchPreparation;
  record: SandboxRecordRow;
  emit: (event: SandboxEvent) => void;
}) {
  const state = createInitialSandboxLaunchState(
    input.record,
    input.launch.repo
  );

  try {
    emitStreamSandboxStatus(input.emit, "creating", state.streamSandboxRecord);

    const environment = await resolveSandboxLaunchEnvironment({
      launch: input.launch,
      emit: input.emit,
    });
    const provisioned = await provisionSandboxForLaunch({
      deps: input.deps,
      launch: input.launch,
      environment,
      emit: input.emit,
      sandboxRecordId: input.record.id,
      sandboxName: buildSandboxName({
        repoId: input.launch.repoId,
        workingBranch: input.launch.launchRequest.workingBranch,
        recordId: input.record.id,
        userId: input.launch.creds.userId,
        productTeamId: input.launch.productTeamId,
        rootDirectory: input.launch.effectiveRootDirectory,
      }),
    });

    state.sandbox = provisioned.sandbox;
    state.restoredFromSnapshot = provisioned.restoredFromSnapshot;
    state.restoredFromBaselineSnapshot =
      provisioned.restoredFromBaselineSnapshot;
    state.shouldQueueDeferredSnapshot = provisioned.shouldQueueDeferredSnapshot;

    const installing = await transitionSandboxRecordToInstalling({
      recordId: input.record.id,
      sandboxId: state.sandbox.name,
      sandbox: state.sandbox,
    });
    if (!installing) {
      await input.deps
        .prepareSandboxBillingClose(input.record.id)
        .catch(() => null);
      await stopSandboxInstanceBestEffort(state.sandbox);
      input.emit({
        type: "error",
        message: "Sandbox creation was superseded by a newer state change.",
        phase: "create",
      });
      return;
    }

    state.streamSandboxRecord = installing;
    await input.deps.requireSandboxBillingSession(
      input.record.id,
      state.sandbox
    );

    // No file or command operation may run before the provider session is
    // either metered, explicitly comped, BYO-billed, or billing-disabled.
    await configureSandboxGitAccess({
      sandbox: state.sandbox,
      githubToken: input.launch.githubToken,
      userId: input.launch.creds.userId,
    });
    // Baseline-restore bootstrap handles branch creation/switching itself via
    // `git checkout -b` + `git push -u origin`, so skip the clone-branch
    // helper for that path to avoid a redundant "branch already exists" race.
    if (
      input.launch.launchRequest.createBranch &&
      !state.restoredFromBaselineSnapshot
    ) {
      await createWorkingBranchInSandbox(state.sandbox, {
        ...input.launch.launchRequest,
        // Use the launch-time effective path so the branch is created in
        // the same workspace the dev server will boot at, not the repo's
        // persistent default.
        rootDirectory: input.launch.effectiveRootDirectory,
      });
    }

    input.emit({
      type: "sandbox_created",
      sandboxId: state.sandbox.name,
      recordId: input.record.id,
      sandbox: toStreamSandboxRecord(state.streamSandboxRecord),
    });

    await queueSandboxReadinessReconciliationWarning({
      deps: input.deps,
      recordId: input.record.id,
      sandboxId: state.sandbox.name,
      emit: input.emit,
    });
    await consumeSandboxBootstrapStream({
      state,
      launch: input.launch,
      deps: input.deps,
      environment,
      emit: input.emit,
    });
  } catch (err) {
    const failure = classifySandboxLaunchFailure(err);
    console.error(`[sandbox/create] ERR_MSG=${failure.message}`);
    console.error(
      `[sandbox/create] repoId=${input.launch.repoId} projectId=${input.launch.createContext.credentials.vercelProjectId} teamId=${input.launch.createContext.credentials.vercelTeamId}`
    );
    await handleSandboxLaunchFailure({
      err,
      state,
      launch: input.launch,
      deps: input.deps,
      emit: input.emit,
    });
  }
}

function buildSandboxLaunchStreamResponse(input: {
  deps: SandboxPostDeps;
  launch: SandboxLaunchPreparation;
  record: SandboxRecordRow;
}) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: SandboxEvent) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(sseEncode(event)));
        } catch {
          cancelled = true;
        }
      };

      try {
        await executeSandboxLaunchStream({
          deps: input.deps,
          launch: input.launch,
          record: input.record,
          emit,
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function createSandboxPostHandler(
  overrides: Partial<SandboxPostDeps> = {}
) {
  const deps: SandboxPostDeps = {
    ...defaultSandboxPostDeps,
    ...overrides,
  };

  return async function POST(request: Request): Promise<Response> {
    // Sandbox CREATE provisions a VM, so gate on `tools.bash`. Solo callers
    // pass no team header and resolve to ALL_CAPABILITIES (no change). Team
    // callers with viewer role hit the denial before any external call.
    const teamId = readActiveTeamIdHeader(request);
    let creds: Awaited<ReturnType<typeof deps.getSandboxServiceCredentials>>;
    try {
      creds = await deps.getSandboxServiceCredentials(request, {
        allowInternal: true,
        teamId,
        requireCapability: "tools.bash",
      });
    } catch (error) {
      if (isSandboxCapabilityDeniedError(error)) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      throw error;
    }
    if (!creds)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const prepared = await prepareSandboxLaunch({
      deps,
      request,
      creds,
      productTeamId: teamId,
    });
    if ("response" in prepared) return prepared.response;

    const existingResponse = await maybeReturnExistingSandboxResponse(
      deps,
      prepared.launch
    );
    if (existingResponse) return existingResponse;

    const limitDecision = await claimSandboxBootLimitOrResponse(
      deps,
      prepared.launch
    );
    if ("response" in limitDecision) return limitDecision.response;

    const collisionResponse = await maybeReturnNameCollisionResponse(
      deps,
      prepared.launch,
      limitDecision.limitClaimId
    );
    if (collisionResponse) return collisionResponse;

    const pendingRecord = await insertPendingSandboxLaunchRecord({
      deps,
      launch: prepared.launch,
      limitClaimId: limitDecision.limitClaimId,
    });
    if ("response" in pendingRecord) return pendingRecord.response;

    return buildSandboxLaunchStreamResponse({
      deps,
      launch: prepared.launch,
      record: pendingRecord.record,
    });
  };
}

export const POST = createSandboxPostHandler();

type SandboxGetDeps = {
  getSandboxServiceCredentials: typeof getSandboxServiceCredentials;
  loadUserPlatformAccess: typeof loadUserPlatformAccess;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
  listSandboxesForUser: (
    userId: string,
    productTeamId: string | null
  ) => Promise<ActiveSandboxRecord[]>;
  findStaleActiveSandboxIds: typeof findStaleActiveSandboxIds;
  stopSandboxRecord: typeof stopSandboxRecord;
};

const defaultSandboxGetDeps: SandboxGetDeps = {
  getSandboxServiceCredentials,
  loadUserPlatformAccess,
  resolveActiveTeamCapabilities,
  async listSandboxesForUser(userId, productTeamId) {
    let query = supabaseAdmin
      .from("sandboxes")
      .select(
        "id, sandbox_id, repo_id, user_id, product_team_id, actor_user_id, base_branch, working_branch, snapshot_id, stop_reason, install_log, dev_log, status, preview_url, runtime, terminal_cwd, root_directory, health_status, error, last_preview_http_status, last_preview_error, last_boot_error, boot_attempts, last_boot_started_at, last_boot_completed_at, created_at, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, persistent, repos(full_name, sandbox_timeout_ms, workspaces(name, sandbox_timeout_ms))"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    query = applyProductTeamScope(query, productTeamId);

    const { data: sandboxes } = await query.limit(10000);

    return (sandboxes ?? []) as ActiveSandboxRecord[];
  },
  findStaleActiveSandboxIds,
  stopSandboxRecord,
};

async function resolveSandboxListProductTeamId(input: {
  deps: Pick<SandboxGetDeps, "resolveActiveTeamCapabilities">;
  userId: string;
  activeTeamId: string | null;
}): Promise<SandboxRouteResponseResult | { productTeamId: string | null }> {
  if (!input.activeTeamId) return { productTeamId: null };

  const activeTeam = await input.deps.resolveActiveTeamCapabilities(
    input.userId,
    input.activeTeamId
  );
  if (!activeTeam.ok) {
    return {
      response: NextResponse.json(
        { error: activeTeam.error },
        { status: activeTeam.status }
      ),
    };
  }

  return { productTeamId: input.activeTeamId };
}

async function reconcileStaleListedSandboxes(input: {
  deps: Pick<SandboxGetDeps, "findStaleActiveSandboxIds" | "stopSandboxRecord">;
  creds: SandboxServiceCredentials;
  sandboxes: ActiveSandboxRecord[];
}) {
  const active = input.sandboxes.filter(
    (sandbox) =>
      ["creating", "installing", "running"].includes(sandbox.status) &&
      sandbox.sandbox_id &&
      sandbox.sandbox_id !== "pending"
  );
  if (active.length === 0) return;

  const { staleIds } = await input.deps.findStaleActiveSandboxIds({
    sandboxCredentials: input.creds,
    records: active,
  });
  if (staleIds.size === 0) return;

  for (const staleId of staleIds) {
    await input.deps.stopSandboxRecord(staleId, { stopReason: "vm_gone" });
  }

  for (const sandbox of input.sandboxes) {
    if (staleIds.has(sandbox.id)) {
      sandbox.status = "stopped";
      sandbox.health_status = "stopped";
      sandbox.stop_reason = "vm_gone";
    }
  }
}

export function createSandboxGetHandler(
  overrides: Partial<SandboxGetDeps> = {}
) {
  const deps: SandboxGetDeps = {
    ...defaultSandboxGetDeps,
    ...overrides,
  };

  return async function GET(request: Request) {
    const activeTeamId = readActiveTeamIdHeader(request);
    const baseCreds = await deps.getSandboxServiceCredentials(request, {
      allowInternal: true,
    });
    if (!baseCreds)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const productTeam = await resolveSandboxListProductTeamId({
      deps,
      userId: baseCreds.userId,
      activeTeamId,
    });
    if ("response" in productTeam) return productTeam.response;

    const creds = productTeam.productTeamId
      ? {
          ...baseCreds,
          productTeamId: productTeam.productTeamId,
          allowPlatformSandbox: (
            await deps
              .loadUserPlatformAccess(
                baseCreds.userId,
                productTeam.productTeamId
              )
              .catch(() => ({ allowPlatformSandbox: false }))
          ).allowPlatformSandbox,
        }
      : baseCreds;

    const format = readSandboxFormat(request);
    const sandboxes = await deps.listSandboxesForUser(
      creds.userId,
      productTeam.productTeamId
    );
    if (sandboxes.length === 0) {
      return format === "cli"
        ? NextResponse.json([] as CliSandboxRecord[])
        : NextResponse.json({ sandboxes: [] });
    }

    await reconcileStaleListedSandboxes({ deps, creds, sandboxes });

    if (format === "cli") {
      const visible = sandboxes.filter((s) =>
        CLI_VISIBLE_STATUSES.has(s.status)
      );
      return NextResponse.json(visible.map(toCliSandboxRecord));
    }

    return NextResponse.json({
      sandboxes: sandboxes.map((sandbox) =>
        toSandboxClientRecord({
          ...sandbox,
          effective_timeout_ms:
            resolveEffectiveTimeoutFromActiveRecord(sandbox),
        })
      ),
    });
  };
}

export const GET = createSandboxGetHandler();
