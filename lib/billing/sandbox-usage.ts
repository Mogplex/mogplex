import type { Sandbox } from "@vercel/sandbox";
import { findBillingAccountForScope } from "@/lib/billing/accounts";
import { isBillingEnabled } from "@/lib/billing/stripe";
import { loadExplicitPlatformAccess } from "@/lib/platform-access";
import { stopSandboxRecord } from "@/lib/sandbox/records";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Vercel bills active sandbox sessions at $0.005/minute. Store the rate in
// micro-USD so elapsed milliseconds can be accumulated without floating-point
// rounding. Stripe price and product IDs never participate in compute billing.
export const SANDBOX_RATE_MICRO_USD_PER_MINUTE = 5_000;
export const SANDBOX_BALANCE_REQUIRED_SQLSTATE = "MP001";

export type ActiveSandboxBillingSession = {
  id: string;
  sandbox_record_id: string;
  vercel_sandbox_id: string;
  vercel_session_id: string;
  account_id: string;
  actor_user_id: string;
  product_team_id: string | null;
  state: "open" | "closing";
  started_at: string;
  metered_through_at: string;
  close_generation: number;
  close_requested_at: string | null;
};

export type SandboxBillingCloseAttempt = {
  sessionId: string;
  closeGeneration: number;
  actorUserId: string;
  meteredThroughAt?: Date;
};

export type SandboxProviderSession = {
  sessionId: string;
  status: string;
  startedAt: Date;
  stoppedAt: Date | null;
  updatedAt: Date;
};

export type SandboxBillingSyncResult = {
  metered: boolean;
  reason:
    | "opened"
    | "already_open"
    | "billing_disabled"
    | "allowlisted"
    | "not_platform_billed"
    | "no_billing_account";
  sessionId: string | null;
};

export type SandboxBillingRecordIdentity = {
  id: string;
  sandbox_id: string;
  billing_source?: string | null;
  actor_user_id?: string | null;
  user_id: string;
  product_team_id?: string | null;
};

export class SandboxBillingAdmissionError extends Error {
  constructor(
    message: string,
    readonly reason: "no_billing_account" | "metering_failed"
  ) {
    super(message);
    this.name = "SandboxBillingAdmissionError";
  }
}

export function sandboxBillingBalanceRequiredError(
  message = "Hosted sandbox compute requires a positive balance"
) {
  return Object.assign(new Error(message), {
    code: SANDBOX_BALANCE_REQUIRED_SQLSTATE,
  });
}

export function isSandboxBillingBalanceRequiredError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === SANDBOX_BALANCE_REQUIRED_SQLSTATE
  );
}

export function sandboxBillingAdmissionHttpStatus(error: unknown) {
  if (!(error instanceof SandboxBillingAdmissionError)) return null;
  return error.reason === "no_billing_account" ? 402 : 503;
}

type SandboxBillingProvider = Pick<Sandbox, "name" | "currentSession">;

type SandboxUsageDeps = {
  isBillingEnabled: typeof isBillingEnabled;
  loadExplicitPlatformAccess: typeof loadExplicitPlatformAccess;
  findBillingAccountForScope: typeof findBillingAccountForScope;
  loadActiveSession: typeof loadActiveSandboxBillingSession;
  openSession: typeof openSandboxBillingSession;
  requestClose: typeof requestSandboxBillingSessionClose;
  finalizeMetered: typeof finalizeSandboxBillingSessionMetered;
  finalizeUnmetered: typeof finalizeSandboxBillingSessionUnmetered;
  reopen: typeof reopenSandboxBillingSession;
};

const defaultDeps: SandboxUsageDeps = {
  isBillingEnabled,
  loadExplicitPlatformAccess,
  findBillingAccountForScope,
  loadActiveSession: loadActiveSandboxBillingSession,
  openSession: openSandboxBillingSession,
  requestClose: requestSandboxBillingSessionClose,
  finalizeMetered: finalizeSandboxBillingSessionMetered,
  finalizeUnmetered: finalizeSandboxBillingSessionUnmetered,
  reopen: reopenSandboxBillingSession,
};

function singleRpcRow<T>(data: unknown): T | null {
  return (Array.isArray(data) ? data[0] : data) as T | null;
}

function validDate(value: Date | undefined, fallback: Date): Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value
    : fallback;
}

export function readSandboxProviderSession(
  sandbox: SandboxBillingProvider
): SandboxProviderSession {
  const session = sandbox.currentSession();
  const createdAt = validDate(session.createdAt, new Date());
  return {
    sessionId: session.sessionId,
    status: String(session.status ?? "unknown").toLowerCase(),
    startedAt: validDate(session.startedAt, createdAt),
    stoppedAt:
      session.stoppedAt instanceof Date &&
      !Number.isNaN(session.stoppedAt.getTime())
        ? session.stoppedAt
        : null,
    updatedAt: validDate(session.updatedAt, createdAt),
  };
}

export function isSandboxProviderSessionTerminal(
  session: SandboxProviderSession
) {
  return (
    session.stoppedAt !== null ||
    ["stopped", "failed", "aborted", "error"].some((status) =>
      session.status.includes(status)
    )
  );
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

async function closeActiveSession(input: {
  session: ActiveSandboxBillingSession;
  endedAt: Date;
  deps: SandboxUsageDeps;
}) {
  const closeGeneration = await input.deps.requestClose(
    input.session.id,
    input.endedAt
  );
  const attempt: SandboxBillingCloseAttempt = {
    sessionId: input.session.id,
    closeGeneration,
    actorUserId: input.session.actor_user_id,
    meteredThroughAt: new Date(input.session.metered_through_at),
  };
  await input.deps.finalizeMetered(attempt, input.endedAt);
}

export async function syncSandboxBillingSession(
  input: {
    record: SandboxBillingRecordIdentity;
    sandbox: SandboxBillingProvider;
  },
  overrides: Partial<SandboxUsageDeps> = {}
): Promise<SandboxBillingSyncResult> {
  const deps = { ...defaultDeps, ...overrides };
  const provider = readSandboxProviderSession(input.sandbox);
  const actorUserId = input.record.actor_user_id ?? input.record.user_id;
  const active = await deps.loadActiveSession(input.record.id);
  const platformBilled = input.record.billing_source === "platform";
  const billingEnabled = deps.isBillingEnabled();
  const explicitAccess = platformBilled
    ? await deps.loadExplicitPlatformAccess(actorUserId)
    : null;
  const allowlisted = explicitAccess?.allowPlatformSandbox === true;

  const account =
    platformBilled && billingEnabled && !allowlisted
      ? await deps.findBillingAccountForScope(
          input.record.product_team_id
            ? {
                kind: "team",
                userId: actorUserId,
                productTeamId: input.record.product_team_id,
              }
            : {
                kind: "personal",
                userId: actorUserId,
                productTeamId: null,
              }
        )
      : null;
  if (active && active.vercel_session_id !== provider.sessionId) {
    await closeActiveSession({
      session: active,
      endedAt: provider.startedAt,
      // Opening freezes the decision that this provider session is paid.
      // A later allowlist change applies to the replacement session, not the
      // already-incurred tail and one-minute minimum on this one.
      deps,
    });
  } else if (active) {
    return {
      metered: true,
      reason: "already_open",
      sessionId: active.id,
    };
  }

  if (!platformBilled) {
    return { metered: false, reason: "not_platform_billed", sessionId: null };
  }
  if (!billingEnabled) {
    return { metered: false, reason: "billing_disabled", sessionId: null };
  }
  if (allowlisted) {
    return { metered: false, reason: "allowlisted", sessionId: null };
  }
  if (!account) {
    return { metered: false, reason: "no_billing_account", sessionId: null };
  }

  const sessionId = await deps.openSession({
    sandboxRecordId: input.record.id,
    vercelSandboxId: input.sandbox.name,
    vercelSessionId: provider.sessionId,
    accountId: account.id,
    actorUserId,
    productTeamId: input.record.product_team_id ?? null,
    startedAt: provider.startedAt,
  });
  return { metered: true, reason: "opened", sessionId };
}

function isBalanceAdmissionFailure(error: unknown) {
  return isSandboxBillingBalanceRequiredError(error);
}

async function stopSandboxAfterBillingAdmissionFailure(input: {
  sandbox: Sandbox;
  record: SandboxBillingRecordIdentity | null;
  reason: "billing_depleted" | "unknown";
}) {
  let confirmedStopped: boolean;
  try {
    await input.sandbox.stop({ blocking: true });
    confirmedStopped = true;
  } catch (stopError) {
    try {
      confirmedStopped = isSandboxProviderSessionTerminal(
        readSandboxProviderSession(input.sandbox)
      );
    } catch {
      confirmedStopped = false;
    }
    console.warn(
      `[sandbox/billing] Failed to stop unmetered provider session${
        confirmedStopped ? "; terminal state was confirmed" : ""
      }:`,
      stopError
    );
  }

  // A lost or rejected stop response is ambiguous. Keep the platform row
  // active unless the provider confirms termination so the reconciler can
  // retry instead of hiding a VM that may still be consuming compute.
  if (confirmedStopped && input.record) {
    await stopSandboxRecord(input.record.id, {
      expectedSandboxId: input.record.sandbox_id,
      stopReason: input.reason,
    }).catch(() => null);
  }
}

export async function requireSandboxBillingSession(
  sandboxRecordId: string,
  sandbox: Sandbox
): Promise<SandboxBillingSyncResult> {
  const record = await loadSandboxBillingRecordIdentity(sandboxRecordId);
  if (!record) {
    await stopSandboxAfterBillingAdmissionFailure({
      sandbox,
      record: null,
      reason: "unknown",
    });
    throw new SandboxBillingAdmissionError(
      `Sandbox billing record ${sandboxRecordId} was not found`,
      "metering_failed"
    );
  }

  let result: SandboxBillingSyncResult;
  try {
    result = await syncSandboxBillingSession({ record, sandbox });
  } catch (error) {
    const depleted = isBalanceAdmissionFailure(error);
    await stopSandboxAfterBillingAdmissionFailure({
      sandbox,
      record,
      reason: depleted ? "billing_depleted" : "unknown",
    });
    throw new SandboxBillingAdmissionError(
      error instanceof Error ? error.message : "Sandbox metering failed",
      depleted ? "no_billing_account" : "metering_failed"
    );
  }

  if (result.reason === "no_billing_account") {
    await stopSandboxAfterBillingAdmissionFailure({
      sandbox,
      record,
      reason: "billing_depleted",
    });
    throw new SandboxBillingAdmissionError(
      "Hosted sandbox compute requires a positive billing balance",
      "no_billing_account"
    );
  }
  return result;
}

export function createSandboxBillingOnResume(sandboxRecordId: string) {
  return async (sandbox: Sandbox) => {
    await requireSandboxBillingSession(sandboxRecordId, sandbox);
  };
}

export async function prepareSandboxBillingClose(
  sandboxRecordId: string,
  requestedAt = new Date(),
  overrides: Partial<SandboxUsageDeps> = {}
): Promise<SandboxBillingCloseAttempt | null> {
  const deps = { ...defaultDeps, ...overrides };
  const active = await deps.loadActiveSession(sandboxRecordId);
  if (!active) return null;
  const closeGeneration = await deps.requestClose(active.id, requestedAt);
  return {
    sessionId: active.id,
    closeGeneration,
    actorUserId: active.actor_user_id,
    meteredThroughAt: new Date(active.metered_through_at),
  };
}

export async function finalizeSandboxBillingClose(
  attempt: SandboxBillingCloseAttempt | null,
  endedAt: Date,
  overrides: Partial<SandboxUsageDeps> = {}
) {
  if (!attempt) return { finalized: false, metered: false };
  const deps = { ...defaultDeps, ...overrides };
  // Opening freezes the paid identity for this provider session. A later
  // allowlist change or transient Stripe configuration outage must never
  // rewrite already-incurred compute as free.
  const result = await deps.finalizeMetered(attempt, endedAt);
  return { finalized: result.accrued, metered: true };
}

export async function reopenSandboxBillingClose(
  attempt: SandboxBillingCloseAttempt | null,
  overrides: Partial<SandboxUsageDeps> = {}
) {
  if (!attempt) return false;
  const deps = { ...defaultDeps, ...overrides };
  return deps.reopen(attempt);
}
