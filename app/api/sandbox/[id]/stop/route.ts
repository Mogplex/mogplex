import { NextResponse } from "next/server";
// stop/route.ts passes { resume: false } explicitly; keep the direct
// import because the sdk-adapter's getSandboxByName already fixes
// resume:false which matches our need but some callsites pass the
// option object through for consistency with other handlers.
import { getSandbox } from "@/lib/sandbox/client";
import {
  ACTIVE_SANDBOX_STATUSES,
  stopSandboxRecord,
  updateSandboxRecord,
} from "@/lib/sandbox/records";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteRecord,
  resolveLoadedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { isNotFoundError } from "@/lib/sandbox/sdk-adapter";
import { withSandboxMutationLock } from "@/lib/sandbox/mutation-lock";
import { resolveSandboxWorkingDirectory } from "@/lib/sandbox/working-directory";
import {
  UNCOMMITTED_CHANGES_COMMAND,
  parseUncommittedChanges,
  describeUncommittedChanges,
} from "@/lib/agents/tools/sandbox-stop-guard";
import {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
} from "@/lib/billing/sandbox-usage";
import type {
  LoadedSandboxRouteRecord,
  SandboxRouteRecordLike,
} from "@/lib/sandbox/route-context";

// Stop compute without deleting persistent workspace files or snapshots.
const STOPPABLE_SANDBOX_STATUSES = [
  ...ACTIVE_SANDBOX_STATUSES,
  "paused",
] as const;

type SandboxStopRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  status: string;
  root_directory?: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

type SandboxStopDeps = {
  loadOwnedSandboxRouteRecord: typeof loadOwnedSandboxRouteRecord;
  resolveLoadedSandboxRouteContext: typeof resolveLoadedSandboxRouteContext;
  getSandbox: typeof getSandbox;
  stopSandboxRecord: typeof stopSandboxRecord;
  updateSandboxRecord: typeof updateSandboxRecord;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
  withSandboxMutationLock: typeof withSandboxMutationLock;
};

const defaultSandboxStopDeps: SandboxStopDeps = {
  loadOwnedSandboxRouteRecord,
  resolveLoadedSandboxRouteContext,
  getSandbox,
  stopSandboxRecord,
  updateSandboxRecord,
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
  withSandboxMutationLock,
};

type RemoteStopOutcome = {
  snapshotId: string | null;
  credentialFailure: boolean;
  confirmedStopped: boolean;
  endedAt: Date | null;
};

async function stopRemoteSandboxBestEffort<R extends SandboxRouteRecordLike>(
  loaded: LoadedSandboxRouteRecord<R>,
  deps: Pick<
    SandboxStopDeps,
    "resolveLoadedSandboxRouteContext" | "getSandbox"
  >,
  preserveChanges: boolean
): Promise<RemoteStopOutcome | Response> {
  if (loaded.record.sandbox_id === "pending") {
    return {
      snapshotId: null,
      credentialFailure: false,
      confirmedStopped: true,
      endedAt: new Date(),
    };
  }

  const resolved = await deps.resolveLoadedSandboxRouteContext(loaded, {
    hydrateSandboxClient: false,
  });
  if (!resolved.ok) {
    console.error(
      `[sandbox/stop] Credential resolution failed for VM ${loaded.record.sandbox_id} — remote VM may continue running`
    );
    return {
      snapshotId: null,
      credentialFailure: true,
      confirmedStopped: false,
      endedAt: null,
    };
  }

  try {
    const sandbox = await deps.getSandbox(
      loaded.record.sandbox_id,
      {
        vercelToken: resolved.context.credentials.vercelToken,
        vercelTeamId: resolved.context.credentials.vercelTeamId,
        vercelProjectId: resolved.context.credentials.vercelProjectId,
      },
      // Read provider persistence without waking a paused workspace.
      { resume: false }
    );

    if (sandbox.persistent) {
      if (sandbox.status !== "stopped") await sandbox.stop({ blocking: true });
      const session = sandbox.currentSession();
      return {
        snapshotId: sandbox.currentSnapshotId ?? null,
        credentialFailure: false,
        confirmedStopped: true,
        endedAt: session.stoppedAt ?? session.updatedAt ?? new Date(),
      };
    }

    if (preserveChanges) {
      try {
        const result = await sandbox.runCommand({
          cmd: "sh",
          args: ["-lc", UNCOMMITTED_CHANGES_COMMAND],
          cwd: resolveSandboxWorkingDirectory(undefined, loaded.rootDirectory),
        });
        if (result.exitCode !== 0) throw new Error(await result.stderr());
        const report = parseUncommittedChanges(await result.stdout());
        if (report.status === "dirty") {
          return NextResponse.json(
            {
              error: `The sandbox has ${describeUncommittedChanges(report)}. Commit and push first, or confirm discarding changes before stopping.`,
              reason: "uncommitted_changes",
              files: report.files,
            },
            { status: 409 }
          );
        }
      } catch {
        return NextResponse.json(
          {
            error:
              "Could not inspect uncommitted changes. The sandbox was not stopped. Retry or confirm discarding changes.",
            reason: "inspection_unavailable",
          },
          { status: 409 }
        );
      }
    }

    // Legacy disposable workspaces require the work-loss guard above.
    try {
      await sandbox.delete();
      return {
        snapshotId: null,
        credentialFailure: false,
        confirmedStopped: true,
        endedAt: new Date(),
      };
    } catch (error) {
      console.warn(
        `[sandbox/stop] sandbox.delete() failed for ${loaded.record.sandbox_id}; falling back to stop()`,
        error
      );
      try {
        await sandbox.stop({ blocking: true });
        const session = sandbox.currentSession();
        return {
          snapshotId: null,
          credentialFailure: false,
          confirmedStopped: true,
          endedAt: session.stoppedAt ?? session.updatedAt ?? new Date(),
        };
      } catch {
        return {
          snapshotId: null,
          credentialFailure: false,
          confirmedStopped: false,
          endedAt: null,
        };
      }
    }
  } catch (error) {
    return {
      snapshotId: null,
      credentialFailure: false,
      confirmedStopped: isNotFoundError(error),
      // Provider-not-found proves the VM is gone, but not when it ended. Leave
      // the exact end unknown so reconciliation caps billing at the ledger's
      // last confirmed meter timestamp instead of charging through now.
      endedAt: null,
    };
  }
}

export function createSandboxStopHandler(
  overrides: Partial<SandboxStopDeps> = {}
) {
  const deps: SandboxStopDeps = {
    ...defaultSandboxStopDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const loaded = await deps.loadOwnedSandboxRouteRecord<SandboxStopRecord>(
      request,
      id,
      {
        select: "*",
        notFoundMessage: "Sandbox not found",
        requireCapability: "tools.bash",
      }
    );
    if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);

    // Empty-body requests come from the explicit destructive Stop UI. Agent
    // requests always send discardChanges and require the guarded path by default.
    const body = await request.json().catch(() => null);
    const preserveChanges = body?.discardChanges === false;
    const stop = async () => {
      let billingClose: Awaited<ReturnType<typeof prepareSandboxBillingClose>> =
        null;
      try {
        billingClose = await deps.prepareSandboxBillingClose(id);
      } catch (billingError) {
        console.warn(
          `[sandbox/stop] Billing close preparation failed for ${id}; reconciliation will recover:`,
          billingError
        );
      }
      const outcome = await stopRemoteSandboxBestEffort(
        loaded,
        deps,
        preserveChanges
      );
      if (outcome instanceof Response) return outcome;
      const { snapshotId, credentialFailure, confirmedStopped, endedAt } =
        outcome;
      const billingEndedAt =
        endedAt ??
        (confirmedStopped ? (billingClose?.meteredThroughAt ?? null) : null);
      if (confirmedStopped && billingEndedAt) {
        try {
          await deps.finalizeSandboxBillingClose(billingClose, billingEndedAt);
        } catch (billingError) {
          console.warn(
            `[sandbox/stop] VM stopped but billing finalization failed for ${id}; reconciliation will retry:`,
            billingError
          );
        }
      }
      if (confirmedStopped) {
        const stopped = await deps.stopSandboxRecord(id, {
          expectedSandboxId: loaded.record.sandbox_id,
          healthStatus: "stopped",
          fromStatuses: STOPPABLE_SANDBOX_STATUSES,
          stopReason: "manual",
        });
        if (!stopped) {
          await deps.stopSandboxRecord(id, {
            healthStatus: "stopped",
            fromStatuses: STOPPABLE_SANDBOX_STATUSES,
            stopReason: "manual",
          });
        }
      }

      const recordUpdates: Record<string, unknown> = {};
      if (snapshotId) {
        recordUpdates.snapshot_id = snapshotId;
        recordUpdates.snapshot_billing_project_id =
          loaded.record.vercel_project_id ?? loaded.record.billing_project_id;
        recordUpdates.snapshot_billing_team_id =
          loaded.record.vercel_team_id ?? loaded.record.billing_team_id;
      }
      if (credentialFailure) {
        recordUpdates.error = `Remote VM ${loaded.record.sandbox_id} could not be stopped: credentials unresolvable. VM may continue running until the next reaper cycle.`;
      } else if (!confirmedStopped) {
        recordUpdates.error = `Remote VM ${loaded.record.sandbox_id} could not be confirmed stopped. The record remains active for reconciliation.`;
      }
      if (Object.keys(recordUpdates).length > 0) {
        try {
          await deps.updateSandboxRecord(id, recordUpdates);
        } catch (error) {
          console.error(
            "[sandbox/stop] Failed to persist stop metadata:",
            error
          );
        }
      }

      const refreshed =
        await deps.loadOwnedSandboxRouteRecord<SandboxStopRecord>(request, id, {
          select: "*",
          notFoundMessage: "Sandbox not found",
        });
      if (!refreshed.ok) return buildSandboxRouteErrorResponse(refreshed);

      return NextResponse.json({
        sandbox: toSandboxClientRecord(refreshed.record),
      });
    };
    return preserveChanges ? deps.withSandboxMutationLock(id, stop) : stop();
  };
}

export const POST = createSandboxStopHandler();
