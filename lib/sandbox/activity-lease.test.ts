import { expect, it } from "vitest";
import type { Sandbox } from "@vercel/sandbox";
import { renewSandboxActivityLease } from "./activity-lease";

it("reserves the whole execution window before a quiet command begins", async () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const now = createdAt.getTime() + 60_000;
  const executionLease = 35 * 60_000;
  let timeout = 10 * 60_000;
  const sandbox = {
    currentSession: () => ({ createdAt, timeout }),
    extendTimeout: async (extension: number) => {
      timeout += extension;
    },
  } as unknown as Sandbox;

  await renewSandboxActivityLease(sandbox, now, executionLease);
  expect(createdAt.getTime() + timeout).toBe(now + executionLease);
  // A later activity event must never shorten the already-reserved window.
  expect(await renewSandboxActivityLease(sandbox, now + 60_000)).toBe(0);
  expect(createdAt.getTime() + timeout).toBe(now + executionLease);
});

it("propagates a refused extension instead of claiming the lease was acquired", async () => {
  const failure = new Error("sandbox_stopped");
  const sandbox = {
    currentSession: () => ({ createdAt: new Date(0), timeout: 0 }),
    extendTimeout: async () => {
      throw failure;
    },
  } as unknown as Sandbox;
  await expect(renewSandboxActivityLease(sandbox, 0, 35 * 60_000)).rejects.toBe(
    failure
  );
});
