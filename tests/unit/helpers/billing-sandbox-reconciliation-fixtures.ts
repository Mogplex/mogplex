import type { ActiveSandboxBillingSession } from "@/lib/billing/sandbox-usage";

export const NOW = new Date("2026-08-05T11:05:00.000Z");
export const STARTED_AT = new Date("2026-08-05T11:00:00.000Z");

export function session(
  overrides: Partial<ActiveSandboxBillingSession> = {}
): ActiveSandboxBillingSession {
  return {
    id: "billing-session-1",
    sandbox_record_id: "sandbox-record-1",
    vercel_sandbox_id: "provider-sandbox-1",
    vercel_session_id: "provider-session-1",
    account_id: "account-1",
    actor_user_id: "actor-1",
    product_team_id: null,
    state: "open",
    started_at: STARTED_AT.toISOString(),
    metered_through_at: STARTED_AT.toISOString(),
    close_generation: 0,
    close_requested_at: null,
    ...overrides,
  };
}

export function record() {
  return {
    id: "sandbox-record-1",
    sandbox_id: "provider-sandbox-1",
    billing_source: "platform",
    actor_user_id: "actor-1",
    user_id: "owner-1",
    product_team_id: null,
    status: "running",
  };
}

export function providerSession(
  overrides: {
    sessionId?: string;
    status?: string;
    startedAt?: Date;
    stoppedAt?: Date;
    updatedAt?: Date;
  } = {}
) {
  const startedAt = overrides.startedAt ?? STARTED_AT;
  return {
    name: "provider-sandbox-1",
    stop: async () => undefined,
    currentSession: () => ({
      sessionId: overrides.sessionId ?? "provider-session-1",
      status: overrides.status ?? "running",
      createdAt: startedAt,
      startedAt,
      stoppedAt: overrides.stoppedAt,
      updatedAt: overrides.updatedAt ?? NOW,
    }),
  } as never;
}

export function baseDeps() {
  return {
    loadActiveSessions: async () => [session()],
    loadRecords: async () => [record()],
    loadActivePlatformRecords: async () => [],
    getCredentials: () => ({
      vercelToken: "token",
      vercelTeamId: "team",
      vercelProjectId: "project",
    }),
    getSandbox: async () => providerSession(),
    accrue: async () => ({ accrued: true, debitedCents: 2 }),
    prepareClose: async () => ({
      sessionId: "billing-session-1",
      closeGeneration: 1,
      actorUserId: "actor-1",
    }),
    finalizeClose: async () => ({ finalized: true, metered: true }),
    reopenClose: async () => true,
    syncSession: async () => ({
      metered: true,
      reason: "opened" as const,
      sessionId: "billing-session-2",
    }),
    getBalance: async () => ({
      includedCents: 0,
      purchasedCents: 100,
      totalCents: 100,
    }),
    stopRecord: async () => null,
    now: () => NOW,
  };
}
