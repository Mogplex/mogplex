import { after, NextResponse } from "next/server";
import { getSandbox } from "@/lib/sandbox/client";
import { isNotFoundError } from "@/lib/sandbox/sdk-adapter";
import {
  deleteSandboxRecord,
  stopSandboxRecord,
  updateSandboxRecord,
} from "@/lib/sandbox/records";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteRecord,
  resolveLoadedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import type {
  LoadedSandboxRouteRecord,
  SandboxRouteRecordLike,
} from "@/lib/sandbox/route-context";
import type { SandboxRecord } from "@/lib/types";

type SandboxStatusRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  snapshot_id?: string | null;
  install_log?: string | null;
  dev_log?: string | null;
  runtime?: string | null;
  terminal_cwd?: string | null;
  status: string;
  stop_reason?: SandboxRecord["stop_reason"];
  persistent?: boolean | null;
  preview_url?: string | null;
  health_status?: string | null;
  last_health_check_at?: string | null;
  last_preview_http_status?: number | null;
  boot_attempts?: number | null;
  last_boot_started_at?: string | null;
  last_boot_completed_at?: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  error?: string | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  created_at: string;
  last_active_at: string;
};

type SandboxDeleteRecord = {
  id: string;
  user_id?: string | null;
  repo_id?: string | null;
  sandbox_id: string;
  base_branch?: string | null;
  working_branch?: string | null;
  status: string;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  persistent?: boolean | null;
};

type SandboxDetailGetDeps = {
  loadOwnedSandboxRouteRecord: typeof loadOwnedSandboxRouteRecord;
  resolveLoadedSandboxRouteContext: typeof resolveLoadedSandboxRouteContext;
  stopSandboxRecord: typeof stopSandboxRecord;
  updateSandboxRecord: typeof updateSandboxRecord;
  scheduleAfter: typeof after;
};

type SandboxDeleteDeps = {
  loadOwnedSandboxRouteRecord: typeof loadOwnedSandboxRouteRecord;
  resolveLoadedSandboxRouteContext: typeof resolveLoadedSandboxRouteContext;
  getSandbox: typeof getSandbox;
  stopSandboxRecord: typeof stopSandboxRecord;
  updateSandboxRecord: typeof updateSandboxRecord;
  deleteSandboxRecord: typeof deleteSandboxRecord;
};

const defaultSandboxDetailGetDeps: SandboxDetailGetDeps = {
  loadOwnedSandboxRouteRecord,
  resolveLoadedSandboxRouteContext,
  stopSandboxRecord,
  updateSandboxRecord,
  scheduleAfter: after,
};

const defaultSandboxDeleteDeps: SandboxDeleteDeps = {
  loadOwnedSandboxRouteRecord,
  resolveLoadedSandboxRouteContext,
  getSandbox,
  stopSandboxRecord,
  updateSandboxRecord,
  deleteSandboxRecord,
};

function resolveSandboxDetailLiveStatus(
  record: Pick<SandboxStatusRecord, "status" | "persistent">,
  sdkStatus: unknown
): "running" | "stopped" | "paused" {
  if (sdkStatus === "running") return "running";
  // The VM probe only exposes "running" here; every other value means the VM
  // was absent/unusable. Paused is DB state for persistent sandboxes, so a
  // stopped remote probe must not overwrite an intentional pause.
  if (record.status === "paused" && record.persistent === true) {
    return "paused";
  }
  return "stopped";
}

const DELETE_ACTIVE_FROM_STATUSES = [
  "creating",
  "installing",
  "running",
  "paused",
  "error",
] as const;

type RemoteDeleteOutcome =
  | { verified: true; stoppedRemote?: boolean }
  | { verified: false; warning: string; error: string };

function formatRemoteDeleteError(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

async function deleteRemoteSandboxBestEffort<R extends SandboxRouteRecordLike>(
  loaded: LoadedSandboxRouteRecord<R>,
  deps: Pick<
    SandboxDeleteDeps,
    "resolveLoadedSandboxRouteContext" | "getSandbox"
  >
): Promise<RemoteDeleteOutcome> {
  if (loaded.record.sandbox_id === "pending") {
    return { verified: true };
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
      return { verified: true };
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
    await sandbox.stop();
    if (loaded.record.persistent === true) {
      return {
        verified: false,
        warning:
          "Remote VM was stopped but persistent resources could not be verified as deleted. Record marked for reaper cleanup instead of deleted.",
        error: `Remote VM ${loaded.record.sandbox_id} could not be deleted because delete() is unavailable. VM was stopped, but persistent resources may remain. Record kept for reaper cleanup.`,
      };
    }
    return { verified: true, stoppedRemote: true };
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

export function createSandboxDetailGetHandler(
  overrides: Partial<SandboxDetailGetDeps> = {}
) {
  const deps: SandboxDetailGetDeps = {
    ...defaultSandboxDetailGetDeps,
    ...overrides,
  };

  return async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const loaded = await deps.loadOwnedSandboxRouteRecord<SandboxStatusRecord>(
      request,
      id,
      {
        select: "*",
      }
    );
    if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);
    const { record } = loaded;

    if (record.sandbox_id !== "pending") {
      const sandboxData = await deps.resolveLoadedSandboxRouteContext(loaded);
      if (!sandboxData.ok) {
        if (sandboxData.status !== 500)
          return buildSandboxRouteErrorResponse(sandboxData);
        return NextResponse.json({ sandbox: toSandboxClientRecord(record) });
      }

      const liveStatus = resolveSandboxDetailLiveStatus(
        record,
        sandboxData.sandbox?.status
      );
      const shouldRepairStoppedHealthStatus =
        liveStatus === "stopped" &&
        record.status === "stopped" &&
        record.health_status !== "stopped";
      const staleStoppedHealthStatus = record.health_status;
      if (liveStatus !== record.status) {
        let persisted = false;
        try {
          await (liveStatus === "stopped"
            ? deps.stopSandboxRecord(id, {
                expectedSandboxId: record.sandbox_id,
                stopReason: "vm_gone",
              })
            : deps.updateSandboxRecord(
                id,
                { status: "running" },
                {
                  expectedSandboxId: record.sandbox_id,
                }
              ));
          persisted = true;
        } catch (error) {
          console.error(
            `[sandbox/detail] Failed to persist live status reconciliation for ${id}:`,
            error
          );
        }

        record.status = liveStatus;
        // Only reflect the persisted stop reason when the DB write succeeded —
        // a failed UPDATE would otherwise let the response report a reason
        // that isn't actually stored.
        if (persisted && liveStatus === "stopped") {
          record.stop_reason = "vm_gone";
        }
      }

      if (liveStatus === "stopped") {
        record.health_status = "stopped";
      }

      if (shouldRepairStoppedHealthStatus) {
        deps.scheduleAfter(async () => {
          try {
            await deps.updateSandboxRecord(
              id,
              { health_status: "stopped" },
              {
                expectedSandboxId: record.sandbox_id,
                expectedHealthStatus: staleStoppedHealthStatus ?? undefined,
                fromStatuses: "stopped",
              }
            );
          } catch (error) {
            console.error(
              `[sandbox/detail] Failed to repair stopped health status for ${id}:`,
              error
            );
          }
        });
      }
    }

    return NextResponse.json({ sandbox: toSandboxClientRecord(record) });
  };
}

export const GET = createSandboxDetailGetHandler();

export function createSandboxDeleteHandler(
  overrides: Partial<SandboxDeleteDeps> = {}
) {
  const deps: SandboxDeleteDeps = {
    ...defaultSandboxDeleteDeps,
    ...overrides,
  };

  return async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const loaded = await deps.loadOwnedSandboxRouteRecord<SandboxDeleteRecord>(
      request,
      id,
      {
        select:
          "id, user_id, repo_id, sandbox_id, base_branch, working_branch, status, persistent, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id",
        notFoundMessage: "Sandbox not found",
        requireCapability: "tools.bash",
      }
    );
    if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);

    const remoteDelete = await deleteRemoteSandboxBestEffort(loaded, deps);

    if (!remoteDelete.verified) {
      try {
        await (loaded.record.persistent === true
          ? deps.updateSandboxRecord(
              id,
              {
                status: "paused",
                health_status: "paused",
                error: remoteDelete.error,
              },
              {
                expectedSandboxId: loaded.record.sandbox_id,
                fromStatuses: DELETE_ACTIVE_FROM_STATUSES,
              }
            )
          : deps.stopSandboxRecord(id, {
              healthStatus: "stopped",
              stopReason: "manual",
              fromStatuses: DELETE_ACTIVE_FROM_STATUSES,
              additionalUpdates: {
                error: remoteDelete.error,
              },
            }));
      } catch (cleanupError) {
        console.error(
          `[sandbox/delete] Failed to mark row ${id} for reaper cleanup:`,
          cleanupError
        );
      }
      return NextResponse.json({
        ok: true,
        sandboxId: id,
        warning: remoteDelete.warning,
      });
    }

    if (remoteDelete.stoppedRemote) {
      try {
        await deps.stopSandboxRecord(id, {
          healthStatus: "stopped",
          stopReason: "manual",
          fromStatuses: DELETE_ACTIVE_FROM_STATUSES,
        });
      } catch (stopError) {
        console.error(
          `[sandbox/delete] Failed to mark stopped VM ${loaded.record.sandbox_id} before deleting row ${id}:`,
          stopError
        );
      }
    }

    const deleted = await deps.deleteSandboxRecord(id, {
      userId: loaded.auth.userId,
      expectedSandboxId: loaded.record.sandbox_id,
    });
    if (!deleted) {
      await deps.deleteSandboxRecord(id, {
        userId: loaded.auth.userId,
      });
    }

    return NextResponse.json({ ok: true, sandboxId: id });
  };
}

export const DELETE = createSandboxDeleteHandler();
