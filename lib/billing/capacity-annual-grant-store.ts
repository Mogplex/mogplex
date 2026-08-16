import type { SupabaseClient } from "@supabase/supabase-js";
import {
  annualGrantSafeInteger,
  assertAnnualGrantOffset,
  assertCapacityAnnualGrantScheduleInput,
  capacityAnnualGrantRowMatchesInput,
  parseAnnualGrantDate,
  requireAnnualGrantText,
  type AppliedCapacityAnnualGrant,
  type CapacityAnnualGrantSchedule,
  type CapacityAnnualGrantScheduleInput,
} from "@/lib/billing/capacity-annual-grant-model";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UNIQUE_VIOLATION = "23505";

async function readScheduleByOccurrence(
  input: CapacityAnnualGrantScheduleInput,
  client: SupabaseClient
): Promise<CapacityAnnualGrantSchedule | null> {
  const { data, error } = await client
    .from("billing_annual_grant_schedules")
    .select("*")
    .eq("account_id", input.accountId)
    .eq("entitlement_version", input.entitlementVersion)
    .eq("grant_offset", input.occurrence.offset)
    .maybeSingle();
  if (error) {
    throw new Error(`annual grant schedule lookup failed: ${error.message}`);
  }
  return (data as CapacityAnnualGrantSchedule | null) ?? null;
}

export async function findOrCreateCapacityAnnualGrantSchedule(
  input: CapacityAnnualGrantScheduleInput,
  client: SupabaseClient = supabaseAdmin
): Promise<CapacityAnnualGrantSchedule> {
  assertCapacityAnnualGrantScheduleInput(input);
  const row = {
    account_id: input.accountId,
    stripe_subscription_id: input.subscriptionId,
    entitlement_version: input.entitlementVersion,
    price_lookup_key: input.priceLookupKey,
    included_usage_cents: input.includedUsageCents,
    cycle_started_at: input.cycleStartedAt.toISOString(),
    grant_offset: input.occurrence.offset,
    grant_period: input.occurrence.period,
    due_at: input.occurrence.dueAt.toISOString(),
    source_event_id: input.sourceEventId,
  };
  const { data, error } = await client
    .from("billing_annual_grant_schedules")
    .insert(row)
    .select("*")
    .single();
  if (!error) return data as CapacityAnnualGrantSchedule;
  if (error.code !== UNIQUE_VIOLATION) {
    throw new Error(`annual grant schedule insert failed: ${error.message}`);
  }
  const existing = await readScheduleByOccurrence(input, client);
  if (!existing || !capacityAnnualGrantRowMatchesInput(existing, input)) {
    throw new Error("annual grant schedule idempotency conflict");
  }
  return existing;
}

export async function getCapacityAnnualGrantSchedule(
  scheduleId: string,
  client: SupabaseClient = supabaseAdmin
): Promise<CapacityAnnualGrantSchedule> {
  const { data, error } = await client
    .from("billing_annual_grant_schedules")
    .select("*")
    .eq("id", scheduleId)
    .single();
  if (error) {
    throw new Error(`annual grant schedule lookup failed: ${error.message}`);
  }
  return data as CapacityAnnualGrantSchedule;
}

export async function bindCapacityAnnualGrantRuntimeRun(
  scheduleId: string,
  runtimeRunId: string,
  client: SupabaseClient = supabaseAdmin
): Promise<CapacityAnnualGrantSchedule> {
  requireAnnualGrantText(runtimeRunId, "annual grant runtime run id");
  const { data, error } = await client
    .from("billing_annual_grant_schedules")
    .update({
      runtime_run_id: runtimeRunId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduleId)
    .is("runtime_run_id", null)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(`annual grant runtime binding failed: ${error.message}`);
  }
  const bound =
    (data as CapacityAnnualGrantSchedule | null) ??
    (await getCapacityAnnualGrantSchedule(scheduleId, client));
  if (bound.runtime_run_id !== runtimeRunId) {
    throw new Error("annual grant schedule is bound to another runtime run");
  }
  return bound;
}

export async function requestCapacityAnnualGrantCancellations(
  accountId: string,
  keepEntitlementVersion: number | null,
  client: SupabaseClient = supabaseAdmin
): Promise<CapacityAnnualGrantSchedule[]> {
  const { data, error } = await client
    .from("billing_annual_grant_schedules")
    .select("*")
    .eq("account_id", accountId)
    .in("status", ["pending", "cancel_pending"]);
  if (error) {
    throw new Error(
      `annual grant cancellation lookup failed: ${error.message}`
    );
  }
  const candidates = (data as CapacityAnnualGrantSchedule[]).filter(
    (row) =>
      keepEntitlementVersion === null ||
      annualGrantSafeInteger(
        row.entitlement_version,
        "annual grant entitlement version"
      ) !== keepEntitlementVersion
  );
  if (candidates.length === 0) return [];
  const ids = candidates.map((row) => row.id);
  const { error: updateError } = await client
    .from("billing_annual_grant_schedules")
    .update({ status: "cancel_pending", updated_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending");
  if (updateError) {
    throw new Error(
      `annual grant cancellation request failed: ${updateError.message}`
    );
  }
  const { data: pending, error: pendingError } = await client
    .from("billing_annual_grant_schedules")
    .select("*")
    .in("id", ids)
    .eq("status", "cancel_pending");
  if (pendingError) {
    throw new Error(
      `annual grant cancellation confirmation failed: ${pendingError.message}`
    );
  }
  return pending as CapacityAnnualGrantSchedule[];
}

export async function finalizeCapacityAnnualGrantCancellation(
  scheduleId: string,
  client: SupabaseClient = supabaseAdmin
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from("billing_annual_grant_schedules")
    .update({ status: "cancelled", cancelled_at: now, updated_at: now })
    .eq("id", scheduleId)
    .eq("status", "cancel_pending");
  if (error) {
    throw new Error(`annual grant cancellation failed: ${error.message}`);
  }
}

export async function cancelCapacityAnnualGrantSchedule(
  scheduleId: string,
  client: SupabaseClient = supabaseAdmin
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from("billing_annual_grant_schedules")
    .update({ status: "cancelled", cancelled_at: now, updated_at: now })
    .eq("id", scheduleId)
    .in("status", ["pending", "cancel_pending"]);
  if (error) {
    throw new Error(`annual grant cancellation failed: ${error.message}`);
  }
}

function booleanResult(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`annual grant ${label} result is invalid`);
  }
  return value;
}

export async function applyCapacityAnnualGrantSchedule(
  scheduleId: string,
  client: SupabaseClient = supabaseAdmin
): Promise<AppliedCapacityAnnualGrant> {
  const { data, error } = await client.rpc(
    "apply_billing_annual_grant_schedule",
    { p_schedule: scheduleId }
  );
  if (error) {
    throw new Error(`annual grant application failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<
    string,
    unknown
  > | null;
  if (!row) throw new Error("annual grant application returned no result");
  const offset = assertAnnualGrantOffset(
    annualGrantSafeInteger(
      row.grant_offset as number | string,
      "annual grant offset"
    )
  );
  return {
    eligible: booleanResult(row.eligible, "eligible"),
    posted: booleanResult(row.posted, "posted"),
    duplicate: booleanResult(row.duplicate, "duplicate"),
    cancelled: booleanResult(row.cancelled, "cancelled"),
    accountId: requireAnnualGrantText(
      row.account_id,
      "annual grant account id"
    ),
    subscriptionId: requireAnnualGrantText(
      row.stripe_subscription_id,
      "annual grant subscription id"
    ),
    entitlementVersion: annualGrantSafeInteger(
      row.entitlement_version as number | string,
      "annual grant entitlement version"
    ),
    priceLookupKey: requireAnnualGrantText(
      row.price_lookup_key,
      "annual grant price lookup key"
    ),
    includedUsageCents: annualGrantSafeInteger(
      row.included_usage_cents as number | string,
      "annual grant amount"
    ),
    cycleStartedAt: parseAnnualGrantDate(
      row.cycle_started_at as string,
      "annual grant cycle start"
    ),
    occurrence: {
      offset,
      period: requireAnnualGrantText(row.grant_period, "annual grant period"),
      dueAt: parseAnnualGrantDate(
        row.due_at as string,
        "annual grant due time"
      ),
    },
    sourceEventId: requireAnnualGrantText(
      row.source_event_id,
      "annual grant source event id"
    ),
  };
}
