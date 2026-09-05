import { isNotFoundError } from "@/lib/sandbox/sdk-adapter";
import type {
  LoadedSandboxRouteRecord,
  SandboxRouteRecordLike,
} from "@/lib/sandbox/route-context";
import type { RemoteDeleteOutcome, SandboxDeleteDeps } from "./types";

/**
 * Statuses from which a sandbox can be actively deleted.
 */
export const DELETE_ACTIVE_FROM_STATUSES = [
  "creating",
  "installing",
  "running",
  "paused",
  "error",
] as const;

function formatRemoteDeleteError(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * Attempts to delete or stop the remote sandbox VM.
 * Returns an outcome indicating whether the deletion was verified.
 */
export async function deleteRemoteSandboxBestEffort<
  R extends SandboxRouteRecordLike,
>(
  loaded: LoadedSandboxRouteRecord<R>,
  deps: Pick<
    SandboxDeleteDeps,
    "resolveLoadedSandboxRouteContext" | "getSandbox"
  >
): Promise<RemoteDeleteOutcome> {
  if (loaded.record.sandbox_id === "pending") {
    return { verified: true, endedAt: new Date() };
  }

  const resolved = await deps.resolveLoadedSandboxRouteContext(loaded, {
    hydrateSandboxClient: false,
  });
  if (!resolved.ok) {
    console.error(
      `[sandbox/delete] Credential resolution failed for VM ${loaded.record.sandbox_id} — remote VM may continue running`
    );
    return {
      verified: false,
      warning:
        "Remote VM could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
      error: `Remote VM ${loaded.record.sandbox_id} could not be deleted: credentials unresolvable. Record kept for reaper cleanup.`,
    };
  }

  let sandbox: Awaited<ReturnType<SandboxDeleteDeps["getSandbox"]>>;
  try {
    sandbox = await deps.getSandbox(loaded.record.sandbox_id, {
      vercelToken: resolved.context.credentials.vercelToken,
      vercelTeamId: resolved.context.credentials.vercelTeamId,
      vercelProjectId: resolved.context.credentials.vercelProjectId,
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      return { verified: true };
    }
    console.warn(
      `[sandbox/delete] Failed to load VM ${loaded.record.sandbox_id} for delete:`,
      error
    );
    return {
      verified: false,
      warning:
        "Remote VM could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
      error: `Remote VM ${loaded.record.sandbox_id} could not be deleted: ${formatRemoteDeleteError(
        error
      )}. Record kept for reaper cleanup.`,
    };
  }

  if (typeof sandbox.delete === "function") {
    try {
      await sandbox.delete();
      return { verified: true, endedAt: new Date() };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { verified: true };
      }
      console.warn(
        `[sandbox/delete] Failed to delete VM ${loaded.record.sandbox_id}:`,
        error
      );
      return {
        verified: false,
        warning:
          "Remote VM could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
        error: `Remote VM ${loaded.record.sandbox_id} could not be deleted: ${formatRemoteDeleteError(
          error
        )}. Record kept for reaper cleanup.`,
      };
    }
  }

  try {
    await sandbox.stop({ blocking: true });
    const session = sandbox.currentSession();
    const endedAt = session.stoppedAt ?? session.updatedAt ?? new Date();
    if (loaded.record.persistent === true) {
      return {
        verified: false,
        warning:
          "Remote VM was stopped but persistent resources could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
        error: `Remote VM ${loaded.record.sandbox_id} could not be deleted because delete() is unavailable. VM was stopped, but persistent resources may remain. Record kept for reaper cleanup.`,
        endedAt,
      };
    }
    return { verified: true, stoppedRemote: true, endedAt };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { verified: true };
    }
    console.warn(
      `[sandbox/delete] Failed to stop VM ${loaded.record.sandbox_id} after delete() was unavailable:`,
      error
    );
    return {
      verified: false,
      warning:
        "Remote VM could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
      error: `Remote VM ${loaded.record.sandbox_id} could not be deleted or stopped: ${formatRemoteDeleteError(
        error
      )}. Record kept for reaper cleanup.`,
    };
  }
}

/**
 * Resolves the live status of a sandbox based on local record and SDK status.
 */
export function resolveSandboxDetailLiveStatus(
  record: Pick<
    { status: string; persistent?: boolean | null },
    "status" | "persistent"
  >,
  sdkStatus: unknown
): "running" | "stopped" | "paused" | "pausing" {
  // A provider probe cannot supersede an in-flight lifecycle operation.
  if (record.status === "pausing") return "pausing";
  if (sdkStatus === "running") return "running";
  // The VM probe only exposes "running" here; every other value means the VM
  // was absent/unusable. Paused is DB state for persistent sandboxes, so a
  // stopped remote probe must not overwrite an intentional pause.
  if (record.status === "paused" && record.persistent === true) {
    return "paused";
  }
  return "stopped";
}
