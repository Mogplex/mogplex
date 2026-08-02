import { getSandbox } from "@/lib/sandbox/client";
import { applyProductTeamScope } from "@/lib/sandbox/product-team-scope";
import {
  isSandboxExplicitlyNonPersistent,
  readSandboxPersistentFlag,
} from "@/lib/sandbox/persistence";
import { stopSandboxRecord } from "@/lib/sandbox/records";
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
};

const SANDBOX_COLLISION_SELECT =
  "id, sandbox_id, repo_id, user_id, product_team_id, actor_user_id, base_branch, working_branch, snapshot_id, stop_reason, install_log, dev_log, status, preview_url, runtime, terminal_cwd, root_directory, persistent, health_status, last_preview_http_status, last_preview_error, last_boot_error, boot_attempts, last_boot_started_at, last_boot_completed_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, created_at, last_active_at";

const USABLE_RECORD_STATUSES = ["running", "paused"] as const;

function normalizeVercelSandboxStatus(sandbox: VercelSandboxHandle) {
  const status =
    typeof sandbox.status === "string" ? sandbox.status.toLowerCase() : "";
  if (status.includes("error") || status.includes("fail")) return "error";
  if (status.includes("stop") || status.includes("delete")) return "stopped";
  return "usable";
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
    .in("status", [...USABLE_RECORD_STATUSES])
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
};

async function getSandboxForNameCollision(
  deps: ResolveNameCollisionDeps,
  input: ResolveNameCollisionInput
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

  try {
    return {
      sandbox: (await deps.getSandbox(input.name, input.credentials, {
        resume: true,
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
> {
  const deps = { ...defaultResolveNameCollisionDeps, ...overrides };
  const probe = await getSandboxForNameCollision(deps, input);
  if (!probe) return { kind: "create" };
  const { sandbox, revived } = probe;

  const vercelStatus = normalizeVercelSandboxStatus(sandbox);
  const matchingRecord = await deps.loadMatchingRecord(input);
  const matchingRecordMatchesRoot =
    matchingRecord &&
    (matchingRecord.root_directory ?? null) === input.rootDirectory;

  if (vercelStatus === "stopped" && isSandboxExplicitlyNonPersistent(sandbox)) {
    if (matchingRecordMatchesRoot) {
      await deps.stopMatchingRecord(matchingRecord);
    }
    await deps.deleteSandbox(sandbox);
    return { kind: "create" };
  }

  // The resume probe can revive an expired non-persistent session while
  // preserving its filesystem. That new session has no dev process, so
  // adopting it as "running" strands the preview at 502 without bootstrap
  // logs. With no active DB record to preserve, recreate it through the
  // normal launch path so install + dev startup run again.
  if (
    revived &&
    !matchingRecordMatchesRoot &&
    isSandboxExplicitlyNonPersistent(sandbox)
  ) {
    await deps.deleteSandbox(sandbox);
    return { kind: "create" };
  }

  if (matchingRecordMatchesRoot) {
    return { kind: "resume", record: matchingRecord };
  }

  if (vercelStatus === "stopped" || vercelStatus === "error") {
    await deps.deleteSandbox(sandbox);
    return { kind: "create" };
  }

  const adopted = await deps.insertAdoptedRecord({
    ...input,
    persistent: readSandboxPersistentFlag(sandbox) ?? false,
  });
  return { kind: "adopt", record: adopted };
}
