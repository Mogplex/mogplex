import assert from "node:assert/strict";
import test from "node:test";

async function loadZombieReaper() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/zombies/zombie-reaper");
}

type ReaperTable =
  | "ai_calls"
  | "repos"
  | "job_runs"
  | "sandboxes"
  | "connections";

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

  const empty = (table: ReaperTable) => async () => ({
    table,
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  });

  const runner = createZombieReaperRunner({
    reapStaleAiCalls: empty("ai_calls"),
    reapStaleSnapshotLocks: empty("repos"),
    reapStaleJobRuns: empty("job_runs"),
    reapStaleExecLocks: empty("sandboxes"),
    reapStaleConnectionTests: empty("connections"),
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

test("buildZombieReaperResponse reduces the summary to a JSON-safe shape", async () => {
  const { buildZombieReaperResponse } = await loadZombieReaper();

  const response = buildZombieReaperResponse({
    processed: 2,
    reaped: 1,
    message: "[zombie-reaper] reaped 1 (ai_calls=1/1 repos=0/0 job_runs=0/1)",
    tables: [
      {
        table: "ai_calls",
        scanned: 1,
        reaped: 1,
        results: [
          {
            table: "ai_calls",
            id: "call-zombie",
            ageMs: 1_000,
            action: "marked_failed",
          },
        ],
        error: null,
      },
      {
        table: "repos",
        scanned: 0,
        reaped: 0,
        results: [],
        error: null,
      },
      {
        table: "job_runs",
        scanned: 1,
        reaped: 0,
        results: [],
        error: "select failed",
      },
    ],
  });

  assert.equal(response.processed, 2);
  assert.equal(response.reaped, 1);
  assert.equal(response.tables.length, 3);
  assert.deepEqual(response.tables[0]?.sample_ids, ["call-zombie"]);
  assert.equal(response.tables[2]?.error, "select failed");
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

  const empty = (table: ReaperTable) => async () => ({
    table,
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  });

  const runner = createZombieReaperRunner({
    reapStaleAiCalls: empty("ai_calls"),
    reapStaleSnapshotLocks: empty("repos"),
    reapStaleJobRuns: empty("job_runs"),
    reapStaleConnectionTests: empty("connections"),
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

test("classifyExecLockZombie: aged-but-active sandbox is flagged isAged only", async () => {
  const { classifyExecLockZombie } = await loadZombieReaper();
  const now = Date.UTC(2026, 3 /* April */, 26);
  const lockStaleMs = 60_000;

  const result = classifyExecLockZombie(
    {
      status: "running",
      exec_lock_started_at: new Date(now - lockStaleMs - 1).toISOString(),
    },
    now,
    lockStaleMs
  );
  assert.equal(result.isAged, true);
  assert.equal(result.isInactiveStatus, false);
});

test("classifyExecLockZombie: stopped sandbox with a fresh lock is flagged isInactiveStatus only", async () => {
  // The exact production zombie shape: route locked the sandbox, then
  // the sandbox was stopped, but the release never fired.
  const { classifyExecLockZombie } = await loadZombieReaper();
  const now = Date.UTC(2026, 3 /* April */, 26);
  const lockStaleMs = 60_000;

  const result = classifyExecLockZombie(
    {
      status: "stopped",
      exec_lock_started_at: new Date(now - 30).toISOString(),
    },
    now,
    lockStaleMs
  );
  assert.equal(result.isAged, false);
  assert.equal(result.isInactiveStatus, true);
});

test("classifyExecLockZombie: paused / errored / null statuses all read as inactive", async () => {
  const { classifyExecLockZombie } = await loadZombieReaper();
  const now = Date.UTC(2026, 3 /* April */, 26);

  for (const status of ["stopped", "paused", "error", null]) {
    const result = classifyExecLockZombie(
      {
        status: status as string | null,
        exec_lock_started_at: new Date(now).toISOString(),
      },
      now,
      60_000
    );
    assert.equal(
      result.isInactiveStatus,
      true,
      `status=${status} should be inactive`
    );
  }
});

test("classifyExecLockZombie: active fresh-lock row is neither stale nor inactive", async () => {
  // The "skip" defensive branch: SQL filters can race with concurrent
  // acquires; a row that doesn't satisfy either condition by the
  // time the JS predicate runs must be left alone.
  const { classifyExecLockZombie } = await loadZombieReaper();
  const now = Date.UTC(2026, 3 /* April */, 26);

  const result = classifyExecLockZombie(
    {
      status: "running",
      exec_lock_started_at: new Date(now - 1000).toISOString(),
    },
    now,
    60_000
  );
  assert.equal(result.isAged, false);
  assert.equal(result.isInactiveStatus, false);
});

test("classifyExecLockZombie: null exec_lock_started_at reads as isAged so malformed-legacy rows on active sandboxes still get reaped", async () => {
  // Regression for codex review on PR #308: a row with a non-null
  // token but a null timestamp on an *active* sandbox would
  // otherwise be fetched by the SQL OR clause (we explicitly include
  // is.null) but then skipped by the defensive guard, never getting
  // cleaned up. Treating null-age as automatically stale matches
  // isSnapshotBuildStale's convention and closes the gap.
  const { classifyExecLockZombie } = await loadZombieReaper();
  const now = Date.UTC(2026, 3 /* April */, 26);

  // Active status + null timestamp → only isAged catches it.
  const onActive = classifyExecLockZombie(
    { status: "running", exec_lock_started_at: null },
    now,
    60_000
  );
  assert.equal(onActive.ageMs, null);
  assert.equal(onActive.isAged, true);
  assert.equal(onActive.isInactiveStatus, false);

  // Inactive status + null timestamp → both branches flag it.
  // Either alone is sufficient; both being true is fine.
  const onStopped = classifyExecLockZombie(
    { status: "stopped", exec_lock_started_at: null },
    now,
    60_000
  );
  assert.equal(onStopped.ageMs, null);
  assert.equal(onStopped.isAged, true);
  assert.equal(onStopped.isInactiveStatus, true);
});

test("buildZombieReaperResponse caps sample_ids so log surfaces don't pick up unbounded id lists", async () => {
  const { buildZombieReaperResponse } = await loadZombieReaper();

  const ids = Array.from({ length: 25 }, (_, i) => `call-${i}`);
  const response = buildZombieReaperResponse({
    processed: ids.length,
    reaped: ids.length,
    message: "test",
    tables: [
      {
        table: "ai_calls",
        scanned: ids.length,
        reaped: ids.length,
        results: ids.map((id) => ({
          table: "ai_calls" as const,
          id,
          ageMs: 1000,
          action: "marked_failed" as const,
        })),
        error: null,
      },
    ],
  });

  // Sample is bounded; full list never reaches the wire.
  assert.equal(response.tables[0]?.sample_ids.length, 5);
  assert.deepEqual(response.tables[0]?.sample_ids, ids.slice(0, 5));
});

test("classifyConnectionTestZombie: row updated within stale window is not stale", async () => {
  const { classifyConnectionTestZombie, CONNECTION_TEST_STALE_MS } =
    await loadZombieReaper();
  const now = Date.UTC(2026, 3 /* April */, 26);

  const result = classifyConnectionTestZombie(
    { updated_at: new Date(now - 30_000).toISOString() },
    now,
    CONNECTION_TEST_STALE_MS
  );

  assert.equal(result.isStale, false);
  assert.equal(result.ageMs, 30_000);
});

test("classifyConnectionTestZombie: row updated past stale window is stale", async () => {
  const { classifyConnectionTestZombie, CONNECTION_TEST_STALE_MS } =
    await loadZombieReaper();
  const now = Date.UTC(2026, 3 /* April */, 26);

  const result = classifyConnectionTestZombie(
    {
      updated_at: new Date(now - CONNECTION_TEST_STALE_MS - 1).toISOString(),
    },
    now,
    CONNECTION_TEST_STALE_MS
  );

  assert.equal(result.isStale, true);
  assert.ok((result.ageMs ?? 0) >= CONNECTION_TEST_STALE_MS);
});

test("classifyConnectionTestZombie: null updated_at reads as stale (matches isSnapshotBuildStale convention)", async () => {
  // Defensive: the test write path always stamps updated_at, but
  // a null timestamp on a row in 'testing' is unambiguously a
  // zombie — we have no way to compute its age, so the only safe
  // choice is to clean it up. Mirrors classifyExecLockZombie's
  // null-timestamp behaviour.
  const { classifyConnectionTestZombie, CONNECTION_TEST_STALE_MS } =
    await loadZombieReaper();
  const now = Date.UTC(2026, 3, 26);

  const result = classifyConnectionTestZombie(
    { updated_at: null },
    now,
    CONNECTION_TEST_STALE_MS
  );

  assert.equal(result.isStale, true);
  assert.equal(result.ageMs, null);
});

test("CONNECTION_TEST_STALE_MS is conservative enough to not race a real test (>= 5 min)", async () => {
  // Pin the threshold so a future tweak can't shrink it below the
  // worst-case real-world test duration. The MCP one-shot test
  // typically completes in <30s; even an OAuth fallback path with
  // discovery + DCR + token round-trip stays well under 5 min.
  const { CONNECTION_TEST_STALE_MS } = await loadZombieReaper();
  assert.ok(CONNECTION_TEST_STALE_MS >= 5 * 60 * 1000);
});

test("createZombieReaperRunner aggregates connection-test reaps into the connections table summary", async () => {
  // Pins the new fifth target. A reaped stuck-testing connection
  // surfaces under table='connections' with action='released_lock'
  // and detail='test_token_stale'.
  const { createZombieReaperRunner } = await loadZombieReaper();

  const empty = (table: ReaperTable) => async () => ({
    table,
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  });

  const runner = createZombieReaperRunner({
    reapStaleAiCalls: empty("ai_calls"),
    reapStaleSnapshotLocks: empty("repos"),
    reapStaleJobRuns: empty("job_runs"),
    reapStaleExecLocks: empty("sandboxes"),
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
