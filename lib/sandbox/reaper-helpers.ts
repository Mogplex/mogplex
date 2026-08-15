import type { ActiveSandboxLivenessResult } from "@/lib/sandbox/liveness";
import { stopSandboxRecord } from "@/lib/sandbox/records";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ReaperSandboxCredentials =
  | {
      ok: true;
      vercelToken: string;
      vercelTeamId?: string | null;
      vercelProjectId: string;
    }
  | {
      ok: false;
      error: string;
    };

export type StaleStoppedSandboxRecord = {
  id: string;
  sandbox_id: string;
  health_status: string | null;
};

export type StoppedHealthStatusRepairAction =
  | "repaired_stopped_health_status"
  | "stopped_health_status_already_converged";

type RepairStoppedSandboxHealthStatusDeps = {
  stopSandboxRecord: typeof stopSandboxRecord;
};

const defaultRepairStoppedSandboxHealthStatusDeps: RepairStoppedSandboxHealthStatusDeps =
  {
    stopSandboxRecord,
  };

export function toReaperSandboxCredentials(
  liveness: ActiveSandboxLivenessResult | undefined
): ReaperSandboxCredentials {
  if (!liveness) {
    return {
      ok: false,
      error: "Failed to resolve sandbox liveness.",
    };
  }

  if (liveness.kind === "unresolvable") {
    return {
      ok: false,
      error: liveness.error,
    };
  }

  if ("credentials" in liveness && liveness.credentials) {
    return {
      ok: true,
      vercelToken: liveness.credentials.vercelToken,
      vercelTeamId: liveness.credentials.vercelTeamId,
      vercelProjectId: liveness.credentials.vercelProjectId,
    };
  }

  return {
    ok: false,
    error: "Failed to resolve sandbox VM credentials.",
  };
}

export function buildSandboxStopErrorUpdate(status: string, error: string) {
  if (status === "running") {
    return {
      health_status: "error",
      last_preview_error: error,
    };
  }

  return {
    health_status: "error",
    last_boot_error: error,
  };
}

export async function loadStaleStoppedSandboxes(
  client: SupabaseClient = supabaseAdmin
) {
  // Oldest first + capped: a periodic sweep; anything beyond the cap is
  // picked up on the next pass instead of loading unbounded rows at once.
  const { data, error } = await client
    .from("sandboxes")
    .select("id, sandbox_id, health_status")
    .eq("status", "stopped")
    .or("health_status.is.null,health_status.neq.stopped")
    .order("created_at", { ascending: true })
    .limit(10000);

  if (error) {
    throw new Error(`Failed to load stale stopped sandboxes: ${error.message}`);
  }

  return (data ?? []) as StaleStoppedSandboxRecord[];
}

export async function repairStoppedSandboxHealthStatus(
  sandbox: StaleStoppedSandboxRecord,
  deps: RepairStoppedSandboxHealthStatusDeps = defaultRepairStoppedSandboxHealthStatusDeps
) {
  const repaired = await deps.stopSandboxRecord(sandbox.id, {
    expectedSandboxId: sandbox.sandbox_id,
    expectedHealthStatus: sandbox.health_status ?? undefined,
    fromStatuses: "stopped",
    healthStatus: "stopped",
  });

  return {
    repaired: repaired !== null,
    action:
      repaired === null
        ? ("stopped_health_status_already_converged" as const)
        : ("repaired_stopped_health_status" as const),
  };
}
