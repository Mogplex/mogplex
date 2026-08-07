import type { Sandbox } from "@vercel/sandbox";
import { findBillingAccountForScope } from "@/lib/billing/accounts";
import { isBillingEnabled } from "@/lib/billing/stripe";
import { loadExplicitPlatformAccess } from "@/lib/platform-access";
import { stopSandboxRecord } from "@/lib/sandbox/records";

import {
  finalizeSandboxBillingSessionMetered,
  finalizeSandboxBillingSessionUnmetered,
  loadActiveSandboxBillingSession,
  loadSandboxBillingRecordIdentity,
  openSandboxBillingSession,
  reopenSandboxBillingSession,
  requestSandboxBillingSessionClose,
} from "./sandbox-usage-db";
import {
  isSandboxBillingBalanceRequiredError,
  SandboxBillingAdmissionError,
  SANDBOX_BALANCE_REQUIRED_MESSAGE,
  type ActiveSandboxBillingSession,
  type SandboxBillingCloseAttempt,
  type SandboxBillingRecordIdentity,
  type SandboxBillingSyncResult,
  type SandboxProviderSession,
} from "./sandbox-usage-types";

// Re-export types and utilities from extracted modules
export {
  SANDBOX_BALANCE_REQUIRED_SQLSTATE,
  SANDBOX_BALANCE_REQUIRED_MESSAGE,
  SANDBOX_BILLING_UNAVAILABLE_MESSAGE,
  type ActiveSandboxBillingSession,
  type SandboxBillingCloseAttempt,
  type SandboxProviderSession,
  type SandboxBillingSyncResult,
  type SandboxBillingRecordIdentity,
  SandboxBillingAdmissionError,
  sandboxBillingBalanceRequiredError,
  isSandboxBillingBalanceRequiredError,
  presentSandboxBillingAdmissionError,
} from "./sandbox-usage-types";

export {
  loadActiveSandboxBillingSession,
  loadSandboxBillingRecordIdentity,
  openSandboxBillingSession,
  requestSandboxBillingSessionClose,
  reopenSandboxBillingSession,
  accrueSandboxBillingSession,
  finalizeSandboxBillingSessionMetered,
  finalizeSandboxBillingSessionUnmetered,
} from "./sandbox-usage-db";

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

function validDate(value: Date | undefined): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

export function readSandboxProviderSession(
  sandbox: SandboxBillingProvider
): SandboxProviderSession {
  const session = sandbox.currentSession();
  const createdAt = validDate(session.createdAt);
  const providerStartedAt = validDate(session.startedAt) ?? createdAt;
  // An unknown start must never become `now`: rotation uses this timestamp as
  // the predecessor's billing end. Epoch is an explicit conservative sentinel
  // that downstream opening rejects and closing clamps to meteredThroughAt.
  const startedAt = providerStartedAt ?? new Date(0);
  return {
    sessionId: session.sessionId,
    status: String(session.status ?? "unknown").toLowerCase(),
    startedAt,
    hasReliableStartedAt: providerStartedAt !== null,
    stoppedAt: validDate(session.stoppedAt),
    updatedAt: validDate(session.updatedAt) ?? startedAt,
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
  if (active && active.vercel_session_id !== provider.sessionId) {
    await closeActiveSession({
      session: active,
      endedAt: provider.hasReliableStartedAt
        ? provider.startedAt
        : new Date(active.metered_through_at),
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
  if (!provider.hasReliableStartedAt) {
    throw new Error("provider session start timestamp is unavailable");
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
    try {
      await stopSandboxRecord(input.record.id, {
        expectedSandboxId: input.record.sandbox_id,
        stopReason: input.reason,
      });
    } catch (error) {
      console.warn(
        "[sandbox/billing] Provider session stopped but its platform record could not be updated; lifecycle reconciliation will recover:",
        error
      );
    }
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
    if (!depleted) {
      console.error("[sandbox/billing] Provider session admission failed", {
        sandboxRecordId,
        error,
      });
    }
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
      SANDBOX_BALANCE_REQUIRED_MESSAGE,
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

export { SANDBOX_RATE_MICRO_USD_PER_MINUTE } from "@/lib/billing/catalog";
