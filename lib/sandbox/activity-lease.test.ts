import { expect, it } from "vitest";
import type { Sandbox } from "@vercel/sandbox";
import { renewSandboxActivityLease } from "./activity-lease";

it.each([0, 60_000])(
  "does not call the provider when the lease already has %i ms to spare",
  async (spare) => {
    let called = false;
    const sandbox = {
      currentSession: () => ({
        createdAt: new Date(0),
        timeout: 120_000 + spare,
      }),
      extendTimeout: async () => {
        called = true;
      },
    } as unknown as Sandbox;
    expect(await renewSandboxActivityLease(sandbox, 60_000, 60_000)).toBe(0);
    expect(called).toBe(false);
  }
);

it.each([1, 500, 999])(
  "renews a nearly sufficient shared lease by a provider-valid duration (%i ms short)",
  async (shortfall) => {
    const now = 60_000;
    const lease = 35 * 60_000;
    let timeout = now + lease - shortfall;
    const sandbox = {
      currentSession: () => ({ createdAt: new Date(0), timeout }),
      extendTimeout: async (duration: number) => {
        if (duration < 1000) throw new Error("duration should be >= 1000");
        timeout += duration;
      },
    } as unknown as Sandbox;
    await renewSandboxActivityLease(sandbox, now, lease);
    expect(timeout).toBeGreaterThanOrEqual(now + lease);
    expect(timeout).toBeLessThan(now + lease + 1000);
  }
);

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
