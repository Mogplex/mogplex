import assert from "node:assert/strict";
import test from "node:test";
import { loadZombieReaper } from "./helpers/zombie-reaper-fixtures";

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
