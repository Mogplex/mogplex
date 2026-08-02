/**
 * Thin wrapper layer around the `@vercel/sandbox` v2 beta SDK.
 *
 * The v2 API is close enough to v1 that most callers can go direct,
 * but this module exists to give us a single choke-point for:
 * - Future breaking changes between beta releases.
 * - Per-call fallback logic (e.g. 403 on persistent-sandbox permission).
 * - Consistent naming (our callers say `getSandboxByName`, matching
 *   the v2 domain model where identity is a name not an id).
 *
 * Keep this file free of business logic. Feature flags and retries
 * live in `lib/sandbox/client.ts` where the create helpers already
 * resolve persistence options.
 */

import { Sandbox } from "@vercel/sandbox";
import { getSandbox } from "@/lib/sandbox/client";

type SandboxCredentials = Parameters<typeof getSandbox>[1];

/**
 * Fetch a sandbox handle by name without waking a paused VM.
 * The default `resume: false` protects liveness probes + teardown
 * paths from accidentally restarting a persistent sandbox.
 */
export async function getSandboxByName(
  name: string,
  credentials: SandboxCredentials
): Promise<Sandbox> {
  return getSandbox(name, credentials, { resume: false });
}

/**
 * Fetch a sandbox by name, returning null when Vercel doesn't know
 * about it (404). Useful during the v2 backfill window where our DB
 * may reference a sandbox that has already been evicted from Vercel's
 * side, and for liveness / reconciliation paths that need to tolerate
 * drift rather than crash.
 *
 * Non-404 errors still propagate so callers can surface credential
 * failures, network issues, etc. normally.
 */
export async function getSandboxIfExists(
  name: string,
  credentials: SandboxCredentials
): Promise<Sandbox | null> {
  try {
    return await getSandbox(name, credentials, { resume: false });
  } catch (err) {
    if (isNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

export function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  const status = anyErr.status ?? anyErr.statusCode;
  if (status === 404) return true;
  if (typeof anyErr.message !== "string") return false;
  const msg = anyErr.message.toLowerCase();
  return (
    msg.includes("not found") ||
    msg.includes("no such sandbox") ||
    msg.includes("does not exist") ||
    msg.includes("404")
  );
}

/**
 * Fetch a sandbox handle and wake its VM from the last auto-snapshot.
 * Use this when the caller intends to run commands against the VM
 * immediately after — e.g. the native resume endpoint.
 */
export async function resumeSandboxByName(
  name: string,
  credentials: SandboxCredentials
): Promise<Sandbox> {
  return getSandbox(name, credentials, { resume: true });
}

/**
 * List every sandbox visible to the given credentials. Unwraps the
 * v2 response shape ({ sandboxes, pagination }) so callers see a
 * simple array.
 */

/**
 * Create a persistent sandbox from a git source. Honors the
 * ENABLE/DISABLE_PERSISTENT_SANDBOXES kill switches and sets a 7-day
 * auto-snapshot expiration.
 */

/**
 * Create a sandbox from an existing snapshot id. Used for the repo
 * baseline + legacy resume fallback paths. Still persistent by
 * default (the v2 SDK auto-snapshots on stop regardless of source).
 */

/**
 * Capture a one-off snapshot from a running sandbox. Prefer
 * `sandbox.stop()` on persistent sandboxes — Vercel auto-snapshots
 * as part of stop and manages retention via snapshotExpiration.
 * This helper stays for legacy flows (non-persistent, external
 * callers) and for E2E fixtures.
 */

/**
 * Extend the sandbox lifetime by `durationMs` using the v2
 * `update({ timeout })` API (replace-semantics); falls back to
 * `extendTimeout` when the current timeout isn't readable.
 */

export {
  createSandboxForRepo as createPersistentSandboxForRepo,
  extendSandboxTimeout as extendSandboxLifetime,
  createSandboxFromSnapshot as createPersistentSandboxFromSnapshot,
  listVercelSandboxes as listSandboxesForCredentials,
  snapshotSandbox as captureSandboxSnapshot,
} from "@/lib/sandbox/client";
