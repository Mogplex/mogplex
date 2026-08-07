import assert from "node:assert/strict";
import test from "node:test";
import { loadZombieReaper } from "./helpers/zombie-reaper-fixtures";

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
