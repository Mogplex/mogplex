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

  await assert.rejects(
    guard.run(async () => {
      throw new Error("database unavailable");
    }),
    /database unavailable/
  );
  assert.equal(guard.isFinalized(), false);
  assert.equal(await guard.run(async () => undefined), true);
  assert.equal(guard.isFinalized(), true);
});

test("a concurrent Control finalizer retries after the first write fails", async () => {
  const guard = createControlFinalizationGuard();
  let rejectWrite!: (error: Error) => void;
  const blockedFailure = new Promise<void>((_resolve, reject) => {
    rejectWrite = reject;
  });
  let writes = 0;
  const first = guard.run(async () => {
    writes += 1;
    await blockedFailure;
  });
  const second = guard.run(async () => {
    writes += 1;
  });

  rejectWrite(new Error("database unavailable"));
  await assert.rejects(first, /database unavailable/);
  assert.equal(await second, true);
  assert.equal(writes, 2);
  assert.equal(guard.isFinalized(), true);
});
