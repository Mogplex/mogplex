import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSandboxBillingSessions } from "@/lib/billing/sandbox-reconciliation";
import { sandboxBillingBalanceRequiredError } from "@/lib/billing/sandbox-usage";
import {
  NOW,
  STARTED_AT,
  session,
  record,
  providerSession,
  baseDeps,
} from "./helpers/billing-sandbox-reconciliation-fixtures";

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
