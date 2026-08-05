import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSandboxBillingSessions } from "@/lib/billing/sandbox-reconciliation";
import { sandboxBillingBalanceRequiredError } from "@/lib/billing/sandbox-usage";
import type { ActiveSandboxBillingSession } from "@/lib/billing/sandbox-usage";

const NOW = new Date("2026-08-05T11:05:00.000Z");
const STARTED_AT = new Date("2026-08-05T11:00:00.000Z");

function session(
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

function record() {
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

function providerSession(
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

function baseDeps() {
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

test("reconciliation accrues a running current provider session", async () => {
  const calls: unknown[] = [];
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    accrue: async (sessionId, through) => {
      calls.push([sessionId, through]);
      return { accrued: true, debitedCents: 2 };
    },
  });
  assert.deepEqual(calls, [["billing-session-1", NOW]]);
  assert.equal(summary.accrued, 1);
  assert.equal(summary.failed, 0);
});

test("reconciliation finalizes at the provider stopped timestamp", async () => {
  const stoppedAt = new Date("2026-08-05T11:04:12.000Z");
  const calls: unknown[] = [];
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    getSandbox: async () => providerSession({ status: "stopped", stoppedAt }),
    prepareClose: async (recordId, requestedAt) => {
      calls.push(["prepare", recordId, requestedAt]);
      return {
        sessionId: "billing-session-1",
        closeGeneration: 1,
        actorUserId: "actor-1",
      };
    },
    finalizeClose: async (attempt, endedAt) => {
      calls.push(["finalize", attempt, endedAt]);
      return { finalized: true, metered: true };
    },
  });
  assert.deepEqual(calls, [
    ["prepare", "sandbox-record-1", stoppedAt],
    [
      "finalize",
      {
        sessionId: "billing-session-1",
        closeGeneration: 1,
        actorUserId: "actor-1",
      },
      stoppedAt,
    ],
  ]);
  assert.equal(summary.finalized, 1);
});

test("a missing provider sandbox finalizes only through the last confirmed meter time", async () => {
  const calls: Date[] = [];
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    getSandbox: async () => null,
    finalizeClose: async (_attempt, endedAt) => {
      calls.push(endedAt);
      return { finalized: true, metered: true };
    },
  });
  assert.deepEqual(calls, [STARTED_AT]);
  assert.equal(summary.finalized, 1);
});

test("provider rotation closes at the replacement start before syncing it", async () => {
  const replacementStart = new Date("2026-08-05T11:03:00.000Z");
  const calls: unknown[] = [];
  const replacement = providerSession({
    sessionId: "provider-session-2",
    startedAt: replacementStart,
  });
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    getSandbox: async () => replacement,
    prepareClose: async (_recordId, at) => {
      calls.push(["prepare", at]);
      return {
        sessionId: "billing-session-1",
        closeGeneration: 2,
        actorUserId: "actor-1",
      };
    },
    finalizeClose: async (_attempt, at) => {
      calls.push(["finalize", at]);
      return { finalized: true, metered: true };
    },
    syncSession: async ({ sandbox }) => {
      calls.push(["sync", sandbox]);
      return {
        metered: true,
        reason: "opened",
        sessionId: "billing-session-2",
      };
    },
  });
  assert.deepEqual(calls, [
    ["prepare", replacementStart],
    ["finalize", replacementStart],
    ["sync", replacement],
  ]);
  assert.equal(summary.rotated, 1);
});

test("a replacement provider session is stopped immediately when metering cannot open", async () => {
  const replacementStart = new Date("2026-08-05T11:03:00.000Z");
  let stopped = false;
  const stoppedRecords: unknown[] = [];
  const replacement = {
    name: "provider-sandbox-1",
    async stop() {
      stopped = true;
    },
    currentSession: () => ({
      sessionId: "provider-session-2",
      status: stopped ? "stopped" : "running",
      createdAt: replacementStart,
      startedAt: replacementStart,
      stoppedAt: stopped ? NOW : undefined,
      updatedAt: NOW,
    }),
  };
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    getSandbox: async () => replacement as never,
    syncSession: async () => {
      throw sandboxBillingBalanceRequiredError();
    },
    stopRecord: async (id, options) => {
      stoppedRecords.push([id, options]);
      return null;
    },
  });

  assert.equal(stopped, true);
  assert.equal(summary.depleted, 1);
  assert.equal(summary.failed, 0);
  assert.deepEqual(stoppedRecords, [
    [
      "sandbox-record-1",
      {
        expectedSandboxId: "provider-sandbox-1",
        stopReason: "billing_depleted",
      },
    ],
  ]);
});

test("a fresh closing session is left alone while the explicit stop is in flight", async () => {
  const calls: unknown[] = [];
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    loadActiveSessions: async () => [
      session({
        state: "closing",
        close_generation: 4,
        close_requested_at: new Date(NOW.getTime() - 30_000).toISOString(),
      }),
    ],
    reopenClose: async (attempt) => {
      calls.push(["reopen", attempt]);
      return true;
    },
    accrue: async () => {
      calls.push(["accrue"]);
      return { accrued: true, debitedCents: 2 };
    },
  });
  assert.deepEqual(calls, []);
  assert.equal(summary.skipped, 1);
});

test("a stale closing session with a running record recovers before accrual", async () => {
  const calls: unknown[] = [];
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    loadActiveSessions: async () => [
      session({
        state: "closing",
        close_generation: 4,
        close_requested_at: new Date(NOW.getTime() - 180_000).toISOString(),
      }),
    ],
    reopenClose: async (attempt) => {
      calls.push(["reopen", attempt]);
      return true;
    },
    accrue: async () => {
      calls.push(["accrue"]);
      return { accrued: true, debitedCents: 2 };
    },
  });
  assert.deepEqual(calls, [
    [
      "reopen",
      {
        sessionId: "billing-session-1",
        closeGeneration: 4,
        actorUserId: "actor-1",
      },
    ],
    ["accrue"],
  ]);
  assert.equal(summary.accrued, 1);
});

test("missing platform credentials skips without mutating billing state", async () => {
  let accrued = false;
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    getCredentials: () => ({
      vercelToken: null,
      vercelTeamId: null,
      vercelProjectId: null,
    }),
    accrue: async () => {
      accrued = true;
      return { accrued: true, debitedCents: 1 };
    },
  });
  assert.equal(accrued, false);
  assert.equal(summary.skipped, 1);
});

test("an active platform sandbox without a billing row is backfilled from its provider start", async () => {
  const synced: unknown[] = [];
  const runningSandbox = providerSession();
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    loadActiveSessions: async () => [],
    loadRecords: async () => [],
    loadActivePlatformRecords: async () => [record()],
    getSandbox: async () => runningSandbox as never,
    syncSession: async (input) => {
      synced.push(input);
      return {
        metered: true,
        reason: "opened",
        sessionId: "billing-session-backfill",
      };
    },
  });
  assert.deepEqual(synced, [{ record: record(), sandbox: runningSandbox }]);
  assert.equal(summary.opened, 1);
  assert.equal(summary.processed, 1);
});

test("crash-gap recovery runs before an oversized metered population", async () => {
  const sessions = Array.from({ length: 101 }, (_, index) =>
    session({
      id: `billing-session-${index}`,
      sandbox_record_id: `metered-record-${index}`,
      vercel_sandbox_id: `metered-provider-${index}`,
      vercel_session_id: `metered-session-${index}`,
    })
  );
  const recoveryRecord = {
    ...record(),
    id: "recovery-record",
    sandbox_id: "recovery-provider",
  };
  const providerLookups: string[] = [];
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    loadActiveSessions: async () => sessions,
    loadRecords: async () =>
      sessions.map((entry) => ({
        ...record(),
        id: entry.sandbox_record_id,
        sandbox_id: entry.vercel_sandbox_id,
      })),
    loadActivePlatformRecords: async () => [recoveryRecord],
    getSandbox: async (sandboxId) => {
      providerLookups.push(sandboxId);
      return sandboxId === recoveryRecord.sandbox_id ? providerSession() : null;
    },
  });

  assert.equal(providerLookups[0], "recovery-provider");
  assert.equal(summary.opened, 1);
});

test("an unfunded backfill confirms a lost stop response before stopping the record", async () => {
  const stoppedRecords: unknown[] = [];
  let terminal = false;
  const runningSandbox = {
    name: "provider-sandbox-1",
    async stop() {
      terminal = true;
      throw new Error("provider response was lost");
    },
    currentSession: () => ({
      sessionId: "provider-session-1",
      status: terminal ? "stopped" : "running",
      createdAt: STARTED_AT,
      startedAt: STARTED_AT,
      stoppedAt: terminal ? NOW : undefined,
      updatedAt: NOW,
    }),
  };
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    loadActiveSessions: async () => [],
    loadRecords: async () => [],
    loadActivePlatformRecords: async () => [record()],
    getSandbox: async () => runningSandbox as never,
    syncSession: async () => {
      throw sandboxBillingBalanceRequiredError();
    },
    stopRecord: async (id, options) => {
      stoppedRecords.push([id, options]);
      return null;
    },
  });
  assert.equal(summary.depleted, 1);
  assert.equal(summary.failed, 0);
  assert.deepEqual(stoppedRecords, [
    [
      "sandbox-record-1",
      {
        expectedSandboxId: "provider-sandbox-1",
        stopReason: "billing_depleted",
      },
    ],
  ]);
});

test("a depleted balance stops compute, finalizes billing, and stops the record", async () => {
  const calls: unknown[] = [];
  const stoppedAt = new Date("2026-08-05T11:05:01.000Z");
  const runningSandbox = {
    name: "provider-sandbox-1",
    stopped: false,
    async stop() {
      calls.push(["provider-stop"]);
      this.stopped = true;
    },
    currentSession() {
      return {
        sessionId: "provider-session-1",
        status: this.stopped ? "stopped" : "running",
        createdAt: STARTED_AT,
        startedAt: STARTED_AT,
        stoppedAt: this.stopped ? stoppedAt : undefined,
        updatedAt: this.stopped ? stoppedAt : NOW,
      };
    },
  };
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    getSandbox: async () => runningSandbox as never,
    getBalance: async () => ({
      includedCents: 0,
      purchasedCents: 0,
      totalCents: 0,
    }),
    prepareClose: async (_recordId, at) => {
      calls.push(["prepare", at]);
      return {
        sessionId: "billing-session-1",
        closeGeneration: 1,
        actorUserId: "actor-1",
      };
    },
    finalizeClose: async (_attempt, at) => {
      calls.push(["finalize", at]);
      return { finalized: true, metered: true };
    },
    stopRecord: async (id, options) => {
      calls.push(["record-stop", id, options]);
      return null;
    },
  });
  assert.deepEqual(calls, [
    ["prepare", NOW],
    ["provider-stop"],
    ["finalize", stoppedAt],
    [
      "record-stop",
      "sandbox-record-1",
      {
        expectedSandboxId: "provider-sandbox-1",
        stopReason: "billing_depleted",
      },
    ],
  ]);
  assert.equal(summary.depleted, 1);
});

test("a depleted sandbox missing after stop closes at the confirmed meter time", async () => {
  const finalizedAt: Date[] = [];
  let providerLookups = 0;
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    getSandbox: async () => {
      providerLookups += 1;
      return providerLookups === 1 ? providerSession() : null;
    },
    getBalance: async () => ({
      includedCents: 0,
      purchasedCents: 0,
      totalCents: 0,
    }),
    prepareClose: async () => ({
      sessionId: "billing-session-1",
      closeGeneration: 1,
      actorUserId: "actor-1",
      meteredThroughAt: STARTED_AT,
    }),
    finalizeClose: async (_attempt, endedAt) => {
      finalizedAt.push(endedAt);
      return { finalized: true, metered: true };
    },
  });

  assert.deepEqual(finalizedAt, [STARTED_AT]);
  assert.equal(summary.depleted, 1);
});

test("depletion after an un-timestamped provider rotation closes at the meter cursor", async () => {
  const finalizedAt: Date[] = [];
  let rotated = false;
  const replacement = {
    name: "provider-sandbox-1",
    async stop() {
      rotated = true;
    },
    currentSession: () =>
      rotated
        ? {
            sessionId: "provider-session-2",
            status: "running",
          }
        : {
            sessionId: "provider-session-1",
            status: "running",
            createdAt: STARTED_AT,
            startedAt: STARTED_AT,
            updatedAt: NOW,
          },
  };
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    getSandbox: async () => replacement as never,
    getBalance: async () => ({
      includedCents: 0,
      purchasedCents: 0,
      totalCents: 0,
    }),
    finalizeClose: async (_attempt, endedAt) => {
      finalizedAt.push(endedAt);
      return { finalized: true, metered: true };
    },
  });

  assert.deepEqual(finalizedAt, [STARTED_AT]);
  assert.equal(summary.depleted, 1);
});

test("a failed depleted stop reopens the exact close attempt", async () => {
  const reopened: unknown[] = [];
  const stillRunning = {
    name: "provider-sandbox-1",
    stop: async () => {
      throw new Error("provider stop failed");
    },
    currentSession: () => ({
      sessionId: "provider-session-1",
      status: "running",
      createdAt: STARTED_AT,
      startedAt: STARTED_AT,
      stoppedAt: undefined,
      updatedAt: NOW,
    }),
  };
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    getSandbox: async () => stillRunning as never,
    getBalance: async () => ({
      includedCents: 0,
      purchasedCents: 0,
      totalCents: 0,
    }),
    reopenClose: async (attempt) => {
      reopened.push(attempt);
      return true;
    },
  });
  assert.deepEqual(reopened, [
    {
      sessionId: "billing-session-1",
      closeGeneration: 1,
      actorUserId: "actor-1",
    },
  ]);
  assert.equal(summary.failed, 1);
});

test("one provider failure is isolated from the remaining sessions", async () => {
  const second = session({
    id: "billing-session-2",
    sandbox_record_id: "sandbox-record-2",
    vercel_sandbox_id: "provider-sandbox-2",
    vercel_session_id: "provider-session-2",
  });
  const summary = await reconcileSandboxBillingSessions({
    ...baseDeps(),
    loadActiveSessions: async () => [session(), second],
    loadRecords: async () => [
      record(),
      { ...record(), id: "sandbox-record-2", sandbox_id: "provider-sandbox-2" },
    ],
    getSandbox: async (name) => {
      if (name === "provider-sandbox-1") throw new Error("provider 429");
      return providerSession({ sessionId: "provider-session-2" });
    },
  });
  assert.equal(summary.failed, 1);
  assert.equal(summary.accrued, 1);
  assert.deepEqual(summary.errors, [
    { sessionId: "billing-session-1", message: "provider 429" },
  ]);
});
