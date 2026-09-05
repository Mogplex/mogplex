import { after, NextResponse } from "next/server";
import { getSandbox } from "@/lib/sandbox/client";
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
import {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
} from "@/lib/billing/sandbox-usage";
import {
  DELETE_ACTIVE_FROM_STATUSES,
  deleteRemoteSandboxBestEffort,
  resolveSandboxDetailLiveStatus,
} from "./_lib/delete-remote";
import type {
  SandboxDeleteDeps,
  SandboxDeleteRecord,
  SandboxDetailGetDeps,
  SandboxStatusRecord,
} from "./_lib/types";

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
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
};

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
          const updated = await (liveStatus === "stopped"
            ? deps.stopSandboxRecord(id, {
                expectedSandboxId: record.sandbox_id,
                fromStatuses: record.status,
                stopReason: "vm_gone",
              })
            : deps.updateSandboxRecord(
                id,
                { status: "running" },
                {
                  expectedSandboxId: record.sandbox_id,
                  fromStatuses: record.status,
                }
              ));
          if (!updated) {
            const latest =
              await deps.loadOwnedSandboxRouteRecord<SandboxStatusRecord>(
                request,
                id,
                { select: "*" }
              );
            if (!latest.ok) return buildSandboxRouteErrorResponse(latest);
            return NextResponse.json({
              sandbox: toSandboxClientRecord(latest.record),
            });
          }
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

    let billingClose: Awaited<ReturnType<typeof prepareSandboxBillingClose>> =
      null;
    try {
      billingClose = await deps.prepareSandboxBillingClose(id);
    } catch (billingError) {
      console.warn(
        `[sandbox/delete] Billing close preparation failed for ${id}; reconciliation will recover:`,
        billingError
      );
    }
    const remoteDelete = await deleteRemoteSandboxBestEffort(loaded, deps);
    const billingEndedAt =
      remoteDelete.endedAt ??
      (remoteDelete.verified ? (billingClose?.meteredThroughAt ?? null) : null);
    let billingFinalizationConfirmed = billingClose === null;
    if (billingClose && billingEndedAt) {
      try {
        const finalized = await deps.finalizeSandboxBillingClose(
          billingClose,
          billingEndedAt
        );
        billingFinalizationConfirmed = finalized.finalized;
      } catch (billingError) {
        console.warn(
          `[sandbox/delete] VM stopped but billing finalization failed for ${id}; reconciliation will retry:`,
          billingError
        );
      }
    }

    if (remoteDelete.verified && !billingFinalizationConfirmed) {
      const warning =
        "Remote sandbox is gone. Billing closure is still reconciling; retry delete shortly.";
      try {
        await deps.updateSandboxRecord(
          id,
          {
            status: "error",
            health_status: "stopped",
            error: warning,
          },
          {
            expectedSandboxId: loaded.record.sandbox_id,
            fromStatuses: DELETE_ACTIVE_FROM_STATUSES,
          }
        );
      } catch (cleanupError) {
        console.error(
          `[sandbox/delete] Failed to preserve row ${id} while billing closes:`,
          cleanupError
        );
      }
      return NextResponse.json(
        { ok: true, sandboxId: id, warning },
        { status: 202 }
      );
    }

    if (!remoteDelete.verified) {
      try {
        await deps.updateSandboxRecord(
          id,
          loaded.record.persistent === true
            ? {
                status: "paused",
                health_status: "paused",
                error: remoteDelete.error,
              }
            : {
                status: "error",
                health_status: "error",
                error: remoteDelete.error,
              },
          {
            expectedSandboxId: loaded.record.sandbox_id,
            fromStatuses: DELETE_ACTIVE_FROM_STATUSES,
          }
        );
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
