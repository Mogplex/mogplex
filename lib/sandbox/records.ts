import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getSandboxCostCentsPerSecond,
  hasSandboxCostRateOverride,
} from "@/lib/sandbox/cost-rates";
import { ACTIVE_SANDBOX_STATUSES } from "@/lib/sandbox/statuses";
import type { SandboxLifecycleStatus, StopReason } from "@/lib/types";

type SandboxStatus = SandboxLifecycleStatus;

type UpdateSandboxOptions = {
  expectedSandboxId?: string;
  fromStatuses?: SandboxStatus | readonly SandboxStatus[];
  expectedHealthStatus?: string;
  select?: string;
};

export async function updateSandboxRecord(
  id: string,
  updates: Record<string, unknown>,
  options: UpdateSandboxOptions = {}
) {
  const {
    expectedSandboxId,
    fromStatuses,
    expectedHealthStatus,
    select = "id, sandbox_id, status, health_status",
  } = options;
  const hasEmbeddedSelect = select.includes("(");
  const writeSelect = hasEmbeddedSelect
    ? "id, sandbox_id, status, health_status"
    : select;

  let query = supabaseAdmin.from("sandboxes").update(updates).eq("id", id);

  if (expectedSandboxId) {
    query = query.eq("sandbox_id", expectedSandboxId);
  }

  if (expectedHealthStatus) {
    query = query.eq("health_status", expectedHealthStatus);
  }

  if (fromStatuses) {
    query = Array.isArray(fromStatuses)
      ? query.in("status", fromStatuses)
      : query.eq("status", fromStatuses);
  }

  const { data, error } = await query.select(writeSelect).maybeSingle();

  if (error) {
    throw new Error(`Failed to update sandbox ${id}: ${error.message}`);
  }

  if (!data || !hasEmbeddedSelect) return data;

  const { data: reloaded, error: reloadError } = await supabaseAdmin
    .from("sandboxes")
    .select(select)
    .eq("id", id)
    .maybeSingle();

  if (reloadError) {
    throw new Error(`Failed to reload sandbox ${id}: ${reloadError.message}`);
  }

  return reloaded;
}

type StopSandboxProtectedKey = "status" | "health_status" | "stop_reason";

// Partial<Record<K, never>> forbids callers from passing the protected keys —
// any attempt to set status / health_status / stop_reason via
// additionalUpdates becomes a compile error. This works because `never` is
// the bottom type: no value (not even `undefined`) is assignable to it, so
// the only way to satisfy `{ status?: never }` is to omit the key entirely.
// The intersection with Record<string, unknown> keeps all other keys open.
type StopSandboxAdditionalUpdates = Record<string, unknown> &
  Partial<Record<StopSandboxProtectedKey, never>>;

export async function stopSandboxRecord(
  id: string,
  options: Omit<UpdateSandboxOptions, "select"> & {
    healthStatus?: string;
    stopReason?: StopReason | null;
    // status / health_status / stop_reason are owned by stopSandboxRecord and
    // would silently override the explicit options below if passed in here.
    additionalUpdates?: StopSandboxAdditionalUpdates;
  } = {}
) {
  // compute_seconds uses created_at as the start, so install time and any
  // pre-run overhead are included. Accepted tradeoff for MVP telemetry.
  //
  // The sandbox_compute_cost_on_stop BEFORE UPDATE trigger (see
  // supabase/migrations/20260417120100_sandbox_cost_trigger.sql) atomically
  // fills stopped_at / compute_seconds / cost_cents_estimate in the same
  // UPDATE when status transitions to 'stopped'. That avoids the TOCTOU race
  // and partial-write inconsistency a prior SELECT+UPDATE pair had.
  //
  // If an operator overrides the default rate via
  // PLATFORM_SANDBOX_COST_CENTS_PER_SECOND, we compute cost_cents_estimate in
  // JS and pass it explicitly; the trigger then respects the caller-provided
  // value instead of recomputing. Unlike the default-rate path, this one has
  // a minor TOCTOU: `stopped_at` is set from `new Date()` before the UPDATE
  // actually runs, so latency between SELECT and UPDATE can inflate
  // `compute_seconds`. Accepted tradeoff for MVP telemetry — the override is
  // only used for rate calibration, not user billing.
  const updates: Record<string, unknown> = {
    ...options.additionalUpdates,
    status: "stopped",
    health_status: options.healthStatus ?? "stopped",
  };
  if ("stopReason" in options) {
    updates.stop_reason = options.stopReason ?? null;
  }

  if (hasSandboxCostRateOverride()) {
    const rateCentsPerSecond = getSandboxCostCentsPerSecond();
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("sandboxes")
      .select("created_at")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) {
      console.error(
        `stopSandboxRecord: failed to fetch created_at for ${id} — rate override will not be applied, trigger default rate will be used instead: ${lookupError.message}`
      );
    }
    const createdAtRaw = (existing as { created_at?: unknown } | null)
      ?.created_at;
    const createdAt =
      typeof createdAtRaw === "string" ? new Date(createdAtRaw) : null;
    if (createdAt && !Number.isNaN(createdAt.getTime())) {
      const stoppedAt = new Date();
      const seconds = Math.max(
        0,
        Math.floor((stoppedAt.getTime() - createdAt.getTime()) / 1000)
      );
      updates.stopped_at = stoppedAt.toISOString();
      updates.compute_seconds = seconds;
      updates.cost_cents_estimate =
        Math.round(seconds * rateCentsPerSecond * 10000) / 10000;
    } else if (!lookupError) {
      console.warn(
        `stopSandboxRecord: missing created_at for ${id} — rate override will not be applied, trigger default rate will be used instead`
      );
    }
  }

  return updateSandboxRecord(id, updates, {
    expectedSandboxId: options.expectedSandboxId,
    fromStatuses: options.fromStatuses ?? ACTIVE_SANDBOX_STATUSES,
    expectedHealthStatus: options.expectedHealthStatus,
  });
}

export async function deleteSandboxRecord(
  id: string,
  options: {
    userId?: string;
    expectedSandboxId?: string;
    select?: string;
  } = {}
) {
  const { userId, expectedSandboxId, select = "id" } = options;

  let query = supabaseAdmin.from("sandboxes").delete().eq("id", id);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  if (expectedSandboxId) {
    query = query.eq("sandbox_id", expectedSandboxId);
  }

  const { data, error } = await query.select(select).maybeSingle();

  if (error) {
    throw new Error(`Failed to delete sandbox ${id}: ${error.message}`);
  }

  return data;
}

export async function touchSandboxLastActive(id: string) {
  const { error } = await supabaseAdmin
    .from("sandboxes")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to touch sandbox ${id}: ${error.message}`);
  }
}

export { ACTIVE_SANDBOX_STATUSES } from "@/lib/sandbox/statuses";
