import type { Sandbox } from "@vercel/sandbox";
import { extendSandboxTimeout } from "@/lib/sandbox/client";

export const SANDBOX_ACTIVITY_LEASE_MS = 5 * 60 * 1000;
// External workers already allow 30 minutes. Reserve that whole window plus
// the existing activity grace so quiet work cannot expire ahead of its worker.
export const SANDBOX_AGENT_EXECUTION_LEASE_MS =
  30 * 60 * 1000 + SANDBOX_ACTIVITY_LEASE_MS;

type SandboxSessionClock = {
  createdAt: Date;
  timeout: number;
};

export function resolveSandboxActivityLeaseExtension(
  session: SandboxSessionClock,
  nowMs = Date.now(),
  leaseMs = SANDBOX_ACTIVITY_LEASE_MS
) {
  const expiresAtMs = session.createdAt.getTime() + session.timeout;
  return Math.max(0, nowMs + leaseMs - expiresAtMs);
}

/**
 * Keep the active VM alive for the requested window (five minutes by default).
 * This is called from request and stream events, never from a timer.
 */
export async function renewSandboxActivityLease(
  sandbox: Sandbox,
  nowMs = Date.now(),
  leaseMs = SANDBOX_ACTIVITY_LEASE_MS
) {
  const session = sandbox.currentSession();
  const extensionMs = resolveSandboxActivityLeaseExtension(
    session,
    nowMs,
    leaseMs
  );
  if (extensionMs > 0) {
    await extendSandboxTimeout(sandbox, extensionMs);
  }
  return extensionMs;
}
