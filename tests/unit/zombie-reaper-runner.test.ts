import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyReaperResult,
  loadZombieReaper,
} from "./helpers/zombie-reaper-fixtures";

test("createZombieReaperRunner aggregates per-table summaries and emits Sentry warning when reaped > 0", async () => {
  const { createZombieReaperRunner } = await loadZombieReaper();
  const captures: Array<{
    message: string;
    extra: Record<string, unknown>;
  }> = [];

  const runner = createZombieReaperRunner({
    reapStaleAiCalls: async () => ({
      table: "ai_calls",
      scanned: 3,
      reaped: 2,
      results: [
        {
          table: "ai_calls",
          id: "call-1",
          ageMs: 600_000,
          action: "marked_failed",
          detail: "chat",
        },
        {
          table: "ai_calls",
          id: "call-2",
          ageMs: 700_000,
          action: "marked_failed",
          detail: "chat",
        },
      ],
      error: null,
    }),
    reapStaleSnapshotLocks: async () => ({
      table: "repos",
      scanned: 1,
      reaped: 1,
      results: [
        {
          table: "repos",
          id: "repo-1",
          ageMs: 16 * 60 * 1000,
          action: "released_lock",
          detail: "snapshot_build_token",
        },
      ],
      error: null,
    }),
    reapStaleJobRuns: async () => ({
      table: "job_runs",
      scanned: 0,
      reaped: 0,
      results: [],
      error: null,
    }),
    reapStaleExecLocks: async () => ({
      table: "sandboxes",
      scanned: 0,
      reaped: 0,
      results: [],
      error: null,
    }),
    reapStaleConnectionTests: async () => ({
      table: "connections",
      scanned: 0,
      reaped: 0,
      results: [],
      error: null,
    }),
    captureWarning: (message, extra) => {
      captures.push({ message, extra });
    },
  });

  const summary = await runner();

  assert.equal(summary.processed, 4);
  assert.equal(summary.reaped, 3);
  assert.equal(summary.tables.length, 5);
  assert.equal(summary.message.includes("ai_calls=2/3"), true);
  assert.equal(summary.message.includes("repos=1/1"), true);
  assert.equal(summary.message.includes("job_runs=0/0"), true);
  assert.equal(summary.message.includes("sandboxes=0/0"), true);
  assert.equal(summary.message.includes("connections=0/0"), true);

  assert.equal(captures.length, 1);
  assert.equal(captures[0]?.message, "[zombie-reaper] reaped stale rows");
  assert.equal(captures[0]?.extra.reaped, 3);
});

test("createZombieReaperRunner stays silent when nothing was reaped", async () => {
  const { createZombieReaperRunner } = await loadZombieReaper();
  const captures: Array<{
    message: string;
    extra: Record<string, unknown>;
  }> = [];

  const runner = createZombieReaperRunner({
    reapStaleAiCalls: emptyReaperResult("ai_calls"),
    reapStaleSnapshotLocks: emptyReaperResult("repos"),
    reapStaleJobRuns: emptyReaperResult("job_runs"),
    reapStaleExecLocks: emptyReaperResult("sandboxes"),
    reapStaleConnectionTests: emptyReaperResult("connections"),
    captureWarning: (message, extra) => {
      captures.push({ message, extra });
    },
  });

  const summary = await runner();

  assert.equal(summary.reaped, 0);
  assert.equal(captures.length, 0);
});

test("createZombieReaperRunner reports per-reaper failures without aborting siblings", async () => {
  const { createZombieReaperRunner } = await loadZombieReaper();

  const runner = createZombieReaperRunner({
    reapStaleAiCalls: async () => {
      throw new Error("boom");
    },
    reapStaleSnapshotLocks: async () => ({
      table: "repos",
      scanned: 0,
      reaped: 0,
      results: [],
      error: null,
    }),
    reapStaleJobRuns: async () => ({
      table: "job_runs",
      scanned: 1,
      reaped: 1,
      results: [
        {
          table: "job_runs",
          id: "job-1",
          ageMs: 7 * 60 * 60 * 1000,
          action: "cancelled",
          detail: "ZOMBIE_REAPED",
        },
      ],
      error: null,
    }),
    reapStaleExecLocks: async () => ({
      table: "sandboxes",
      scanned: 0,
      reaped: 0,
      results: [],
      error: null,
    }),
    reapStaleConnectionTests: async () => ({
      table: "connections",
      scanned: 0,
      reaped: 0,
      results: [],
      error: null,
    }),
    captureWarning: () => {},
  });

  const summary = await runner();

  // Sibling reapers continue.
  assert.equal(summary.reaped, 1);
  assert.equal(summary.tables.length, 5);

  // Failed reaper surfaces its error in the table summary, not the
  // overall message-only level. Aggregate message also includes the
  // error string so ops can spot it from a single log line.
  const aiTable = summary.tables.find((t) => t.table === "ai_calls");
  assert.equal(aiTable?.error, "boom");
  assert.equal(summary.message.includes("ai_calls: boom"), true);
});

test("ZombieReaperResult.ageMs is null when the anchor is missing/unparseable, not zero", async () => {
  // Regression for mogplex review on PR #302: an ageMs of 0 looks
  // identical to a "0ms old false positive" in Sentry / HTTP logs.
  // Reaped rows that legitimately had no anchor (e.g. malformed
  // legacy snapshot-build locks) must surface as null so ops can
  // distinguish the case.
  const { createZombieReaperRunner } = await loadZombieReaper();

  const runner = createZombieReaperRunner({
    reapStaleAiCalls: async () => ({
      table: "ai_calls",
      scanned: 0,
      reaped: 0,
      results: [],
      error: null,
    }),
    reapStaleSnapshotLocks: async () => ({
      table: "repos",
      scanned: 1,
      reaped: 1,
      results: [
        {
          table: "repos",
          id: "repo-malformed-legacy",
          ageMs: null,
          action: "released_lock",
          detail: "snapshot_build_token",
        },
      ],
      error: null,
    }),
    reapStaleJobRuns: async () => ({
      table: "job_runs",
      scanned: 0,
      reaped: 0,
      results: [],
      error: null,
    }),
    reapStaleExecLocks: async () => ({
      table: "sandboxes",
      scanned: 0,
      reaped: 0,
      results: [],
      error: null,
    }),
    reapStaleConnectionTests: async () => ({
      table: "connections",
      scanned: 0,
      reaped: 0,
      results: [],
      error: null,
    }),
    captureWarning: () => {},
  });

  const summary = await runner();
  const repoTable = summary.tables.find((t) => t.table === "repos");
  assert.equal(repoTable?.results[0]?.ageMs, null);
});

test("createZombieReaperRunner aggregates exec_lock reaps into the sandbox table summary", async () => {
  // Pins the new fourth target. A reaped exec_lock surfaces under
  // table='sandboxes' with action='released_lock' and detail
  // describing why (stale age vs inactive status).
  const { createZombieReaperRunner } = await loadZombieReaper();

  const runner = createZombieReaperRunner({
    reapStaleAiCalls: emptyReaperResult("ai_calls"),
    reapStaleSnapshotLocks: emptyReaperResult("repos"),
    reapStaleJobRuns: emptyReaperResult("job_runs"),
    reapStaleConnectionTests: emptyReaperResult("connections"),
    reapStaleExecLocks: async () => ({
      table: "sandboxes",
      scanned: 4,
      reaped: 4,
      results: [
        {
          table: "sandboxes",
          id: "sb-aged",
          ageMs: 60 * 60 * 1000,
          action: "released_lock",
          detail: "exec_lock_stale",
        },
        {
          table: "sandboxes",
          id: "sb-inactive",
          ageMs: null,
          action: "released_lock",
          detail: "inactive_status:stopped",
        },
        // Pins the contract for null-status reaps: the human-readable
        // "(missing)" sentinel is the agreed wire format. The string
        // "null" would read as a serialization artifact in Sentry.
        {
          table: "sandboxes",
          id: "sb-null-status",
          ageMs: null,
          action: "released_lock",
          detail: "inactive_status:(missing)",
        },
        // Pins the both-conditions case: when a row is BOTH aged AND on
        // an inactive status, the detail string preserves both reasons
        // joined by '+'. Otherwise an operator querying Sentry for
        // 'exec_lock_stale' would miss this subset entirely.
        {
          table: "sandboxes",
          id: "sb-aged-and-inactive",
          ageMs: 60 * 60 * 1000,
          action: "released_lock",
          detail: "exec_lock_stale+inactive_status:stopped",
        },
      ],
      error: null,
    }),
    captureWarning: () => {},
  });

  const summary = await runner();
  const sandboxTable = summary.tables.find((t) => t.table === "sandboxes");
  assert.equal(sandboxTable?.reaped, 4);
  assert.equal(summary.message.includes("sandboxes=4/4"), true);
  assert.equal(
    sandboxTable?.results.find((r) => r.id === "sb-null-status")?.detail,
    "inactive_status:(missing)"
  );
  assert.equal(
    sandboxTable?.results.find((r) => r.id === "sb-inactive")?.detail,
    "inactive_status:stopped"
  );
  assert.equal(
    sandboxTable?.results.find((r) => r.id === "sb-aged-and-inactive")?.detail,
    "exec_lock_stale+inactive_status:stopped"
  );
});

test("createZombieReaperRunner aggregates connection-test reaps into the connections table summary", async () => {
  // Pins the new fifth target. A reaped stuck-testing connection
  // surfaces under table='connections' with action='released_lock'
  // and detail='test_token_stale'.
  const { createZombieReaperRunner } = await loadZombieReaper();

  const runner = createZombieReaperRunner({
    reapStaleAiCalls: emptyReaperResult("ai_calls"),
    reapStaleSnapshotLocks: emptyReaperResult("repos"),
    reapStaleJobRuns: emptyReaperResult("job_runs"),
    reapStaleExecLocks: emptyReaperResult("sandboxes"),
    reapStaleConnectionTests: async () => ({
      table: "connections",
      scanned: 2,
      reaped: 2,
      results: [
        {
          table: "connections",
          id: "conn-stuck-1",
          ageMs: 20 * 60 * 1000,
          action: "released_lock",
          detail: "test_token_stale",
        },
        {
          table: "connections",
          id: "conn-malformed-legacy",
          ageMs: null,
          action: "released_lock",
          detail: "test_token_stale",
        },
      ],
      error: null,
    }),
    captureWarning: () => {},
  });

  const summary = await runner();
  const connectionsTable = summary.tables.find(
    (t) => t.table === "connections"
  );
  assert.equal(connectionsTable?.reaped, 2);
  assert.equal(summary.message.includes("connections=2/2"), true);
  assert.equal(
    connectionsTable?.results.find((r) => r.id === "conn-stuck-1")?.detail,
    "test_token_stale"
  );
  assert.equal(
    connectionsTable?.results.find((r) => r.id === "conn-malformed-legacy")
      ?.ageMs,
    null
  );
});
