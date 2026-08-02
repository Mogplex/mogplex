import assert from "node:assert/strict";
import test from "node:test";

async function loadReaper() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/baseline-snapshot-reaper");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-04-18T00:00:00Z");

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    full_name: "owner/repo",
    snapshot_id: "snap_1",
    snapshot_created_at: new Date(now.getTime() - 2 * DAY_MS).toISOString(),
    snapshot_billing_team_id: null,
    snapshot_billing_project_id: null,
    last_sandbox_launch_at: new Date(now.getTime() - DAY_MS).toISOString(),
    ...overrides,
  };
}

test("shouldReapBaselineSnapshot skips repos with no snapshot", async () => {
  const { shouldReapBaselineSnapshot } = await loadReaper();
  const decision = shouldReapBaselineSnapshot(makeRepo({ snapshot_id: null }), {
    maxAgeDays: 14,
    idleDays: 30,
    now,
  });
  assert.equal(decision.reap, false);
  assert.equal(decision.reason, "no_snapshot");
});

test("shouldReapBaselineSnapshot keeps young, recently-launched snapshots", async () => {
  const { shouldReapBaselineSnapshot } = await loadReaper();
  const decision = shouldReapBaselineSnapshot(makeRepo(), {
    maxAgeDays: 14,
    idleDays: 30,
    now,
  });
  assert.equal(decision.reap, false);
});

test("shouldReapBaselineSnapshot reaps on stale age", async () => {
  const { shouldReapBaselineSnapshot } = await loadReaper();
  const decision = shouldReapBaselineSnapshot(
    makeRepo({
      snapshot_created_at: new Date(now.getTime() - 20 * DAY_MS).toISOString(),
    }),
    { maxAgeDays: 14, idleDays: 30, now }
  );
  assert.equal(decision.reap, true);
  assert.equal(decision.reason, "stale_age");
});

test("shouldReapBaselineSnapshot reaps on idle", async () => {
  const { shouldReapBaselineSnapshot } = await loadReaper();
  const decision = shouldReapBaselineSnapshot(
    makeRepo({
      last_sandbox_launch_at: new Date(
        now.getTime() - 45 * DAY_MS
      ).toISOString(),
    }),
    { maxAgeDays: 90, idleDays: 30, now }
  );
  assert.equal(decision.reap, true);
  assert.equal(decision.reason, "idle");
});

test("shouldReapBaselineSnapshot reaps when snapshot_created_at is missing", async () => {
  const { shouldReapBaselineSnapshot } = await loadReaper();
  const decision = shouldReapBaselineSnapshot(
    makeRepo({ snapshot_created_at: null }),
    { maxAgeDays: 14, idleDays: 30, now }
  );
  assert.equal(decision.reap, true);
  assert.equal(decision.reason, "missing_timestamp");
});

test("shouldReapBaselineSnapshot reaps never-launched snapshots after idle window", async () => {
  const { shouldReapBaselineSnapshot } = await loadReaper();
  const decision = shouldReapBaselineSnapshot(
    makeRepo({
      snapshot_created_at: new Date(now.getTime() - 40 * DAY_MS).toISOString(),
      last_sandbox_launch_at: null,
    }),
    { maxAgeDays: 90, idleDays: 30, now }
  );
  assert.equal(decision.reap, true);
  assert.equal(decision.reason, "idle");
});

test("runBaselineSnapshotReaper deletes vercel snapshot and clears row", async () => {
  const { runBaselineSnapshotReaper } = await loadReaper();
  const candidates = [
    makeRepo({ id: "r1", snapshot_id: "s1" }),
    makeRepo({
      id: "r2",
      snapshot_id: "s2",
      snapshot_created_at: new Date(now.getTime() - 100 * DAY_MS).toISOString(),
    }),
  ];
  const deletedSnapshots: string[] = [];
  const clearedRepos: string[] = [];

  const summary = await runBaselineSnapshotReaper(
    { maxAgeDays: 14, idleDays: 30 },
    {
      loadCandidates: async () => candidates,
      clearRepoSnapshot: async (repoId) => {
        clearedRepos.push(repoId);
      },
      deleteSnapshot: async ({ snapshotId }) => {
        deletedSnapshots.push(snapshotId);
      },
      resolveSnapshotCredentials: async () => ({
        token: "tok",
        teamId: null,
      }),
      now: () => now,
    }
  );

  assert.equal(summary.processed, 2);
  assert.equal(summary.reaped, 1);
  assert.deepEqual(deletedSnapshots, ["s2"]);
  assert.deepEqual(clearedRepos, ["r2"]);
  assert.equal(summary.reasons.stale_age, 1);
});
