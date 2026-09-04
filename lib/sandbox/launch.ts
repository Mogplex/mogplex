import { getSandbox } from "@/lib/sandbox/client";
import { requireSandboxBillingSession } from "@/lib/billing/sandbox-usage";
import { applyProductTeamScope } from "@/lib/sandbox/product-team-scope";
import {
  isSandboxExplicitlyNonPersistent,
  readSandboxPersistentFlag,
} from "@/lib/sandbox/persistence";
import { stopSandboxRecord } from "@/lib/sandbox/records";
import {
  deleteVercelSandboxByName,
  findVercelSandboxByName,
} from "@/lib/sandbox/named-sandbox";
import { isNotFoundError } from "@/lib/sandbox/sdk-adapter";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";
import type { SandboxLifecycleStatus, SandboxRecord } from "@/lib/types";

export type VercelCredentials = {
  vercelToken: string;
  vercelTeamId?: string | null;
  vercelProjectId: string;
};

type VercelSandboxHandle = {
  name?: string;
  status?: unknown;
  persistent?: unknown;
  sandbox?: { persistent?: unknown };
  delete?: () => Promise<unknown>;
};

type ResolveNameCollisionInput = {
  name: string;
  repoId: string;
  userId: string;
  productTeamId?: string | null;
  actorUserId?: string | null;
  workingBranch: string;
  rootDirectory: string | null;
  credentials: VercelCredentials;
  baseBranch?: string | null;
  runtime?: SandboxRuntime | null;
  billingSource?: SandboxBillingMode | null;
  billingTeamId?: string | null;
  billingProjectId?: string | null;
  limitClaimId?: string | null;
  persistent?: boolean | null;
};

type ResolveNameCollisionDeps = {
  getSandbox: typeof getSandbox;
  loadMatchingRecord: (
    input: Pick<
      ResolveNameCollisionInput,
      | "name"
      | "repoId"
      | "userId"
      | "productTeamId"
      | "workingBranch"
      | "rootDirectory"
    >
  ) => Promise<SandboxRecord | null>;
  insertAdoptedRecord: (
    input: ResolveNameCollisionInput
  ) => Promise<SandboxRecord>;
  stopMatchingRecord: (
    record: Pick<SandboxRecord, "id" | "sandbox_id">
  ) => Promise<unknown>;
  deleteSandbox: (sandbox: VercelSandboxHandle) => Promise<void>;
  requireBillingSession: (
    sandboxRecordId: string,
    sandbox: VercelSandboxHandle
  ) => Promise<unknown>;
  findNamedSandbox: typeof findVercelSandboxByName;
  deleteSandboxByName: typeof deleteVercelSandboxByName;
};

const SANDBOX_COLLISION_SELECT =
  "id, sandbox_id, repo_id, user_id, product_team_id, actor_user_id, base_branch, working_branch, snapshot_id, stop_reason, install_log, dev_log, status, preview_url, runtime, terminal_cwd, root_directory, persistent, health_status, last_preview_http_status, last_preview_error, last_boot_error, boot_attempts, last_boot_started_at, last_boot_completed_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, created_at, last_active_at";

const USABLE_RECORD_STATUSES = ["running", "paused"] as const;
const MATCHABLE_RECORD_STATUSES = [
  ...USABLE_RECORD_STATUSES,
  "stopped",
  "error",
] as const;

function normalizeVercelSandboxStatus(sandbox: VercelSandboxHandle) {
  const status =
    typeof sandbox.status === "string" ? sandbox.status.toLowerCase() : "";
  if (
    status === "stopping" ||
    status === "snapshotting" ||
    status.includes("delet")
  ) {
    return "busy";
  }
  if (status.includes("error") || status.includes("fail")) return "error";
  if (status === "stopped" || status === "aborted") return "stopped";
  return "usable";
}

function isRestartablePersistentRecord(record: SandboxRecord | null) {
  return (
    record?.runtime_summary.persistent === true &&
    (record.runtime_summary.status === "stopped" ||
      record.runtime_summary.status === "error")
  );
}

async function loadMatchingSandboxRecord(input: {
  name: string;
  repoId: string;
  userId: string;
  productTeamId?: string | null;
  workingBranch: string;
  rootDirectory: string | null;
}) {
  let query = supabaseAdmin
    .from("sandboxes")
    .select(SANDBOX_COLLISION_SELECT)
    .eq("sandbox_id", input.name)
    .eq("repo_id", input.repoId)
    .eq("user_id", input.userId)
    .eq("working_branch", input.workingBranch)
    .in("status", [...MATCHABLE_RECORD_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1);

  query =
    input.rootDirectory === null
      ? query.is("root_directory", null)
      : query.eq("root_directory", input.rootDirectory);
  query = applyProductTeamScope(query, input.productTeamId);

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Failed to load matching sandbox record: ${error.message}`);
  }

  return data ? toSandboxClientRecord(data as never) : null;
}

async function insertAdoptedSandboxRecord(input: ResolveNameCollisionInput) {
  const now = new Date().toISOString();
  const baseBranch = input.baseBranch?.trim() || input.workingBranch || "main";
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .insert({
      user_id: input.userId,
      product_team_id: input.productTeamId ?? null,
      actor_user_id: input.actorUserId ?? input.userId,
      repo_id: input.repoId,
      sandbox_id: input.name,
      base_branch: baseBranch,
      working_branch: input.workingBranch || baseBranch,
      status: "running" satisfies SandboxLifecycleStatus,
      health_status: "unknown",
      preview_url: null,
      snapshot_id: null,
      install_log: "",
      dev_log: "",
      runtime: input.runtime ?? null,
      terminal_cwd: input.rootDirectory ?? null,
      root_directory: input.rootDirectory ?? null,
      billing_source: input.billingSource ?? "platform",
      billing_team_id:
        input.billingTeamId ?? input.credentials.vercelTeamId ?? null,
      billing_project_id:
        input.billingProjectId ?? input.credentials.vercelProjectId,
      vercel_team_id: input.credentials.vercelTeamId ?? null,
      vercel_project_id: input.credentials.vercelProjectId,
      sandbox_billing_target: input.credentials.vercelTeamId
        ? "team"
        : "personal",
      persistent: input.persistent ?? false,
      last_active_at: now,
      limit_claim_id: input.limitClaimId ?? null,
    })
    .select(SANDBOX_COLLISION_SELECT)
    .single();

  if (error) {
    throw new Error(`Failed to adopt orphaned sandbox: ${error.message}`);
  }

  return toSandboxClientRecord(data as never);
}

const defaultResolveNameCollisionDeps: ResolveNameCollisionDeps = {
  getSandbox,
  loadMatchingRecord: loadMatchingSandboxRecord,
  insertAdoptedRecord: insertAdoptedSandboxRecord,
  stopMatchingRecord(record) {
    return stopSandboxRecord(record.id, {
      expectedSandboxId: record.sandbox_id,
      fromStatuses: [...USABLE_RECORD_STATUSES],
      stopReason: "vm_gone",
    });
  },
  async deleteSandbox(sandbox) {
    await sandbox.delete?.();
  },
  requireBillingSession(sandboxRecordId, sandbox) {
    return requireSandboxBillingSession(sandboxRecordId, sandbox as never);
  },
  findNamedSandbox: findVercelSandboxByName,
  deleteSandboxByName: deleteVercelSandboxByName,
};

function matchRecordForRoot(
  record: SandboxRecord | null,
  rootDirectory: string | null
) {
  return record && (record.root_directory ?? null) === rootDirectory
    ? record
    : null;
}

/**
 * Neither probe could retrieve the name. That does not prove the name is
 * free: Vercel keeps a named-sandbox entity after its sessions and snapshot
 * expire, and in that state GET returns 404 while a create with the same name
 * is rejected as a duplicate. Confirm through the list endpoint and free the
 * name before handing the launch to the fresh-create path.
 */
async function resolveUnretrievableName(
  deps: ResolveNameCollisionDeps,
  input: ResolveNameCollisionInput,
  matchingRecord: SandboxRecord | null
): Promise<
  { kind: "create" } | { kind: "replace"; record: SandboxRecord | null }
> {
  const stale = await deps.findNamedSandbox(input.name, input.credentials);
  if (!stale) return { kind: "create" };

  const matchingRecordForRoot = matchRecordForRoot(
    matchingRecord,
    input.rootDirectory
  );
  const staleStatus = normalizeVercelSandboxStatus(stale);
  if (staleStatus !== "stopped" && staleStatus !== "error") {
    // The provider still reports activity we cannot attach to. Leave it
    // alone and roll this launch forward under a replacement name.
    return { kind: "replace", record: matchingRecordForRoot };
  }

  // The provider has nothing left to resume, so a record that still looks
  // live is stale. Retire it before the name is reused.
  if (matchingRecordForRoot) {
    await deps.stopMatchingRecord(matchingRecordForRoot);
  }

  try {
    await deps.deleteSandboxByName(input.name, input.credentials);
  } catch (error: unknown) {
    console.warn("[sandbox/launch] could not free stale sandbox name", {
      name: input.name,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "replace", record: matchingRecordForRoot };
  }

  console.info("[sandbox/launch] freed stale sandbox name for reuse", {
    name: input.name,
    previousSandboxRecordId: matchingRecordForRoot?.id ?? null,
  });
  return { kind: "create" };
}

async function getSandboxForNameCollision(
  deps: ResolveNameCollisionDeps,
  input: ResolveNameCollisionInput,
  matchingRecord: SandboxRecord | null
): Promise<{
  sandbox: VercelSandboxHandle;
  revived: boolean;
} | null> {
  try {
    return {
      sandbox: (await deps.getSandbox(input.name, input.credentials, {
        resume: false,
      })) as unknown as VercelSandboxHandle,
      revived: false,
    };
  } catch (error: unknown) {
    if (!isNotFoundError(error)) throw error;
  }

  // A terminal persistent DB record should only be restarted when its named
  // provider sandbox still exists. Do not let this collision probe wake it;
  // the restart route owns admission, resume, and bootstrap. If the provider
  // cannot retrieve the name, resolveUnretrievableName decides whether it is
  // free or merely stale.
  if (isRestartablePersistentRecord(matchingRecord)) return null;

  try {
    return {
      sandbox: (await deps.getSandbox(input.name, input.credentials, {
        resume: true,
        ...(matchingRecord?.billing_summary.source === "platform"
          ? {
              onResume: async (sandbox) => {
                await deps.requireBillingSession(
                  matchingRecord.id,
                  sandbox as unknown as VercelSandboxHandle
                );
              },
            }
          : {}),
      })) as unknown as VercelSandboxHandle,
      revived: true,
    };
  } catch (error: unknown) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function resolveNameCollision(
  input: ResolveNameCollisionInput,
  overrides: Partial<ResolveNameCollisionDeps> = {}
): Promise<
  | { kind: "create" }
  | { kind: "adopt"; record: SandboxRecord }
  | { kind: "resume"; record: SandboxRecord }
  | { kind: "restart"; record: SandboxRecord }
  | { kind: "replace"; record: SandboxRecord | null }
  | { kind: "busy"; record: SandboxRecord | null }
> {
  const deps = { ...defaultResolveNameCollisionDeps, ...overrides };
  // Load the canonical record before a resume probe so provider admission can
  // be attached before that probe is allowed to wake a paid sandbox.
  const matchingRecord = await deps.loadMatchingRecord(input);
  const probe = await getSandboxForNameCollision(deps, input, matchingRecord);
  if (!probe) return resolveUnretrievableName(deps, input, matchingRecord);
  const { sandbox, revived } = probe;

  const vercelStatus = normalizeVercelSandboxStatus(sandbox);
  const matchingRecordForRoot = matchRecordForRoot(
    matchingRecord,
    input.rootDirectory
  );
  const matchingRecordNeedsRestart = isRestartablePersistentRecord(
    matchingRecordForRoot
  );
  const matchingRecordIsPersistent =
    matchingRecordForRoot?.runtime_summary.persistent === true;

  // Stopping and snapshotting are provider transition states, not terminal
  // states. A live record stays attached to event-driven cleanup recovery. If
  // persistence already says the predecessor is terminal, roll the requested
  // launch forward under a replacement name instead of recreating a stale
  // wait after a service restart.
  if (vercelStatus === "busy") {
    if (
      !matchingRecordForRoot ||
      matchingRecordForRoot.runtime_summary.status === "stopped" ||
      matchingRecordForRoot.runtime_summary.status === "paused" ||
      matchingRecordForRoot.runtime_summary.status === "error"
    ) {
      return { kind: "replace", record: matchingRecordForRoot };
    }
    return { kind: "busy", record: matchingRecordForRoot };
  }

  // A stopped/error persistent record already has the canonical provider
  // identity and filesystem history. Hand it to the normal restart lifecycle,
  // which performs admission, resumes the provider session, and bootstraps the
  // dev server on the same record.
  if (
    matchingRecordIsPersistent &&
    (matchingRecordNeedsRestart || vercelStatus === "stopped")
  ) {
    return { kind: "restart", record: matchingRecordForRoot };
  }

  if (vercelStatus === "stopped" && isSandboxExplicitlyNonPersistent(sandbox)) {
    if (matchingRecordForRoot) {
      await deps.stopMatchingRecord(matchingRecordForRoot);
    }
    await deps.deleteSandbox(sandbox);
    return { kind: "replace", record: matchingRecordForRoot };
  }

  // The resume probe can revive an expired non-persistent session while
  // preserving its filesystem. That new session has no dev process, so
  // adopting it as "running" strands the preview at 502 without bootstrap
  // logs. With no active DB record to preserve, recreate it through the
  // normal launch path so install + dev startup run again.
  if (
    revived &&
    !matchingRecordForRoot &&
    isSandboxExplicitlyNonPersistent(sandbox)
  ) {
    await deps.deleteSandbox(sandbox);
    return { kind: "replace", record: null };
  }

  if (matchingRecordForRoot) {
    return { kind: "resume", record: matchingRecordForRoot };
  }

  if (vercelStatus === "stopped" || vercelStatus === "error") {
    await deps.deleteSandbox(sandbox);
    return { kind: "replace", record: null };
  }

  const adopted = await deps.insertAdoptedRecord({
    ...input,
    persistent: readSandboxPersistentFlag(sandbox) ?? false,
  });
  if (input.billingSource === "platform") {
    await deps.requireBillingSession(adopted.id, sandbox);
  }
  return { kind: "adopt", record: adopted };
}
