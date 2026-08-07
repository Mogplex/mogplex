import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSandboxBillingSessions } from "@/lib/billing/sandbox-reconciliation";
import { sandboxBillingBalanceRequiredError } from "@/lib/billing/sandbox-usage";
import {
  NOW,
  STARTED_AT,
  session,
  providerSession,
  baseDeps,
} from "./helpers/billing-sandbox-reconciliation-fixtures";

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
