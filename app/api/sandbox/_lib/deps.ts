import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import { getOwnedRepoWithGithubAccessToken } from "@/lib/github-access";
import { loadUserPlatformAccess } from "@/lib/platform-access";
import { resolveActiveTeamCapabilities } from "@/lib/team-capabilities";
import {
  stopSandboxRecord,
  ACTIVE_SANDBOX_STATUSES,
} from "@/lib/sandbox/records";
import {
  createSandboxForRepo,
  createSandboxFromSnapshot,
} from "@/lib/sandbox/client";
import { enforceSandboxBootLimits } from "@/lib/request-limits";
import { startDeferredRepoSnapshotBuild } from "@/lib/workflows/repo-snapshot-workflow";
import { startSandboxReadinessReconciliation } from "@/lib/sandbox/readiness-reconciliation";
import { resolveSandboxAiAccess } from "@/lib/sandbox/ai-runtime";
import {
  resolveActiveSandboxState,
  findStaleActiveSandboxIds,
} from "@/lib/sandbox/liveness";
import { validateVercelProjectAccess } from "@/lib/vercel/service";
import { resolveNameCollision } from "@/lib/sandbox/launch";
import { applyProductTeamScope } from "@/lib/sandbox/product-team-scope";
import {
  requireSandboxBillingSession,
  prepareSandboxBillingClose,
} from "@/lib/billing/sandbox-usage";
import type { PersistedVercelLinkState } from "@/lib/vercel/reconciliation";
import type { ActiveSandboxRecord, SandboxRepoRecord } from "./types";

export type SandboxPostDeps = {
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
  restartSandboxRecord: (
    request: Request,
    sandboxRecordId: string
  ) => Promise<Response>;
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

export async function getActiveSandboxForRepo(
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

  // rootDirectory === undefined  -> caller doesn't care, return any path's
  //                                 sandbox (legacy behaviour, used by
  //                                 settings/observability lookups).
  // rootDirectory === null       -> match rows with no root override
  //                                 (sandbox running at repo root).
  // rootDirectory is a string    -> match exactly.
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

export const defaultSandboxPostDeps: SandboxPostDeps = {
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
  async restartSandboxRecord(request, sandboxRecordId) {
    const { createSandboxRestartHandler } =
      await import("@/app/api/sandbox/[id]/restart/route");
    return createSandboxRestartHandler()(request, {
      params: Promise.resolve({ id: sandboxRecordId }),
    });
  },
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

export type SandboxGetDeps = {
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

export const defaultSandboxGetDeps: SandboxGetDeps = {
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
