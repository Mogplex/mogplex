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

test("a concurrent Control finalizer retries after the joined attempt fails", async () => {
  const guard = createControlFinalizationGuard();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstAttempts = 0;
  let secondAttempts = 0;
  const first = guard.run(async () => {
    firstAttempts += 1;
    if (firstAttempts === 1) await blocked;
    throw new Error("database unavailable");
  });
  const second = guard.run(async () => {
    secondAttempts += 1;
  });

  release();
  await assert.rejects(first, /database unavailable/);
  assert.equal(await second, true);
  assert.equal(firstAttempts, 2);
  assert.equal(secondAttempts, 1);
  assert.equal(guard.isFinalized(), true);
});

test("joined Control finalizers serialize replacement attempts", async () => {
  const guard = createControlFinalizationGuard();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstAttempts = 0;
  let secondAttempts = 0;
  let thirdAttempts = 0;
  const first = guard.run(async () => {
    firstAttempts += 1;
    if (firstAttempts === 1) await blocked;
    throw new Error("first unavailable");
  });
  const second = guard.run(async () => {
    secondAttempts += 1;
    throw new Error("second unavailable");
  });
  const third = guard.run(async () => {
    thirdAttempts += 1;
  });

  release();
  await assert.rejects(first, /first unavailable/);
  await assert.rejects(second, /second unavailable/);
  assert.equal(await third, true);
  assert.equal(firstAttempts, 2);
  assert.equal(secondAttempts, 2);
  assert.equal(thirdAttempts, 1);
  assert.equal(guard.isFinalized(), true);
});
