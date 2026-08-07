/**
 * Database operations for sandbox billing sessions.
 * @module
 */

import { SANDBOX_RATE_MICRO_USD_PER_MINUTE } from "@/lib/billing/catalog";
import { supabaseAdmin } from "@/lib/supabase/admin";

import {
  SANDBOX_BALANCE_REQUIRED_SQLSTATE,
  sandboxBillingBalanceRequiredError,
  type ActiveSandboxBillingSession,
  type SandboxBillingCloseAttempt,
  type SandboxBillingRecordIdentity,
} from "./sandbox-usage-types";

function singleRpcRow<T>(data: unknown): T | null {
  return (Array.isArray(data) ? data[0] : data) as T | null;
}

export async function loadActiveSandboxBillingSession(
  sandboxRecordId: string
): Promise<ActiveSandboxBillingSession | null> {
  const { data, error } = await supabaseAdmin
    .from("sandbox_billing_sessions")
    .select(
      "id, sandbox_record_id, vercel_sandbox_id, vercel_session_id, account_id, actor_user_id, product_team_id, state, started_at, metered_through_at, close_generation, close_requested_at"
    )
    .eq("sandbox_record_id", sandboxRecordId)
    .in("state", ["open", "closing"])
    .maybeSingle();
  if (error) {
    throw new Error(`sandbox billing session lookup failed: ${error.message}`);
  }
  return (data as ActiveSandboxBillingSession | null) ?? null;
}

export async function loadSandboxBillingRecordIdentity(
  sandboxRecordId: string
): Promise<SandboxBillingRecordIdentity | null> {
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "id, sandbox_id, billing_source, actor_user_id, user_id, product_team_id"
    )
    .eq("id", sandboxRecordId)
    .maybeSingle();
  if (error) {
    throw new Error(`sandbox billing identity lookup failed: ${error.message}`);
  }
  return (data as SandboxBillingRecordIdentity | null) ?? null;
}

export async function openSandboxBillingSession(input: {
  sandboxRecordId: string;
  vercelSandboxId: string;
  vercelSessionId: string;
  accountId: string;
  actorUserId: string;
  productTeamId: string | null;
  startedAt: Date;
  rateMicroUsdPerMinute?: number;
}): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc(
    "open_sandbox_billing_session",
    {
      p_sandbox_record: input.sandboxRecordId,
      p_vercel_sandbox_id: input.vercelSandboxId,
      p_vercel_session_id: input.vercelSessionId,
      p_account: input.accountId,
      p_actor_user: input.actorUserId,
      p_product_team: input.productTeamId,
      p_started_at: input.startedAt.toISOString(),
      p_rate_micro_usd_per_minute:
        input.rateMicroUsdPerMinute ?? SANDBOX_RATE_MICRO_USD_PER_MINUTE,
    }
  );
  if (error) {
    if (error.code === SANDBOX_BALANCE_REQUIRED_SQLSTATE) {
      throw sandboxBillingBalanceRequiredError(error.message);
    }
    throw new Error(`sandbox billing session open failed: ${error.message}`);
  }
  if (typeof data !== "string" || !data) {
    throw new Error("sandbox billing session open returned no session id");
  }
  return data;
}

export async function requestSandboxBillingSessionClose(
  sessionId: string,
  requestedAt = new Date()
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc(
    "request_sandbox_billing_session_close",
    {
      p_session: sessionId,
      p_requested_at: requestedAt.toISOString(),
    }
  );
  if (error) {
    throw new Error(`sandbox billing close request failed: ${error.message}`);
  }
  const generation = Number(data);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error(`sandbox billing close request returned ${String(data)}`);
  }
  return generation;
}

export async function reopenSandboxBillingSession(
  attempt: SandboxBillingCloseAttempt
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(
    "reopen_sandbox_billing_session",
    {
      p_session: attempt.sessionId,
      p_close_generation: attempt.closeGeneration,
    }
  );
  if (error) {
    throw new Error(`sandbox billing session reopen failed: ${error.message}`);
  }
  return data === true;
}

export async function accrueSandboxBillingSession(
  sessionId: string,
  through: Date
): Promise<{ accrued: boolean; debitedCents: number }> {
  const { data, error } = await supabaseAdmin.rpc(
    "accrue_sandbox_billing_session",
    {
      p_session: sessionId,
      p_through: through.toISOString(),
      p_final: false,
    }
  );
  if (error) {
    throw new Error(`sandbox billing accrual failed: ${error.message}`);
  }
  const row = singleRpcRow<{
    accrued?: boolean;
    debited_cents?: number | string;
  }>(data);
  return {
    accrued: row?.accrued === true,
    debitedCents: Number(row?.debited_cents ?? 0),
  };
}

export async function finalizeSandboxBillingSessionMetered(
  attempt: SandboxBillingCloseAttempt,
  endedAt: Date
): Promise<{ accrued: boolean; debitedCents: number }> {
  const { data, error } = await supabaseAdmin.rpc(
    "accrue_sandbox_billing_session",
    {
      p_session: attempt.sessionId,
      p_through: endedAt.toISOString(),
      p_final: true,
      p_close_generation: attempt.closeGeneration,
    }
  );
  if (error) {
    throw new Error(`sandbox billing final accrual failed: ${error.message}`);
  }
  const row = singleRpcRow<{
    accrued?: boolean;
    debited_cents?: number | string;
  }>(data);
  return {
    accrued: row?.accrued === true,
    debitedCents: Number(row?.debited_cents ?? 0),
  };
}

export async function finalizeSandboxBillingSessionUnmetered(
  attempt: SandboxBillingCloseAttempt,
  endedAt: Date
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(
    "finalize_sandbox_billing_session_unmetered",
    {
      p_session: attempt.sessionId,
      p_ended_at: endedAt.toISOString(),
      p_close_generation: attempt.closeGeneration,
    }
  );
  if (error) {
    throw new Error(
      `sandbox billing unmetered finalization failed: ${error.message}`
    );
  }
  return data === true;
}
