import assert from "node:assert/strict";
import test from "node:test";
import { createControlFinalizationGuard } from "../../app/api/control/chat/_lib/finalization-guard";

test("Control finalization joins concurrent callers and persists once", async () => {
  const guard = createControlFinalizationGuard();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const first = guard.run(async () => {
    writes += 1;
    await blocked;
  });
  const second = guard.run(async () => {
    writes += 1;
  });

  release();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(writes, 1);
  assert.equal(guard.isFinalized(), true);
});

test("Control finalization remains retryable after a persistence failure", async () => {
  const guard = createControlFinalizationGuard();
  let attempts = 0;

  await assert.rejects(
    guard.run(async () => {
      attempts += 1;
      throw new Error("database unavailable");
    }),
    /database unavailable/
  );
  assert.equal(attempts, 2);
  assert.equal(guard.isFinalized(), false);
  assert.equal(await guard.run(async () => undefined), true);
  assert.equal(guard.isFinalized(), true);
});

test("a sole Control finalizer retries one transient persistence failure", async () => {
  const guard = createControlFinalizationGuard();
  let writes = 0;
  const first = guard.run(async () => {
    writes += 1;
    if (writes === 1) throw new Error("database unavailable");
  });
  const second = guard.run(async () => {
    writes += 1;
  });

  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(writes, 2);
  assert.equal(guard.isFinalized(), true);
});
