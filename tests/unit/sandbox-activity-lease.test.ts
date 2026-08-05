import assert from "node:assert/strict";
import test from "node:test";
import {
  renewSandboxActivityLease,
  resolveSandboxActivityLeaseExtension,
  SANDBOX_ACTIVITY_LEASE_MS,
} from "../../lib/sandbox/activity-lease";
import { extendSandboxTimeout } from "../../lib/sandbox/client";

test("activity lease extends the active session to five minutes from now", async () => {
  const createdAt = new Date("2026-08-05T00:30:00.000Z");
  const nowMs = Date.parse("2026-08-05T00:38:00.000Z");
  let timeout = 10 * 60 * 1000;
  const extensions: number[] = [];
  const sandbox = {
    currentSession: () => ({ createdAt, timeout }),
    extendTimeout: async (durationMs: number) => {
      extensions.push(durationMs);
      timeout += durationMs;
    },
  };

  const extendedBy = await renewSandboxActivityLease(sandbox as never, nowMs);

  assert.equal(extendedBy, 3 * 60 * 1000);
  assert.deepEqual(extensions, [3 * 60 * 1000]);
  assert.equal(
    createdAt.getTime() + timeout,
    nowMs + SANDBOX_ACTIVITY_LEASE_MS
  );
});

test("activity lease does not extend a session that already has five minutes left", async () => {
  const extension = resolveSandboxActivityLeaseExtension(
    {
      createdAt: new Date("2026-08-05T00:30:00.000Z"),
      timeout: 10 * 60 * 1000,
    },
    Date.parse("2026-08-05T00:34:00.000Z")
  );

  assert.equal(extension, 0);
});

test("sandbox timeout helper uses the active-session SDK primitive", async () => {
  const calls: Array<[string, unknown]> = [];
  const sandbox = {
    timeout: 10 * 60 * 1000,
    update: async (value: unknown) => calls.push(["update", value]),
    extendTimeout: async (value: number) =>
      calls.push(["extendTimeout", value]),
  };

  await extendSandboxTimeout(sandbox as never, 5 * 60 * 1000);

  assert.deepEqual(calls, [["extendTimeout", 5 * 60 * 1000]]);
});
