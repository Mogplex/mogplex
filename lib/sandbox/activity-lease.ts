import type { Sandbox } from "@vercel/sandbox";
import { extendSandboxTimeout } from "@/lib/sandbox/client";

export const SANDBOX_ACTIVITY_LEASE_MS = 5 * 60 * 1000;

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
 * Keep the active VM alive for at least five minutes after real activity.
 * This is called from request and stream events, never from a timer.
 */
export async function renewSandboxActivityLease(
  sandbox: Sandbox,
  nowMs = Date.now()
) {
  const session = sandbox.currentSession();
  const extensionMs = resolveSandboxActivityLeaseExtension(session, nowMs);
  if (extensionMs > 0) {
    await extendSandboxTimeout(sandbox, extensionMs);
  }
  return extensionMs;
}
