import { NextResponse } from "next/server";
import { getSandboxByName as getSandbox } from "@/lib/sandbox/sdk-adapter";
import { updateSandboxRecord } from "@/lib/sandbox/records";
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

type SandboxPauseRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  status: string;
  persistent?: boolean | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

type SandboxPauseDeps = {
  loadOwnedSandboxRouteRecord: typeof loadOwnedSandboxRouteRecord;
  resolveLoadedSandboxRouteContext: typeof resolveLoadedSandboxRouteContext;
  getSandbox: typeof getSandbox;
  updateSandboxRecord: typeof updateSandboxRecord;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
};

const defaultSandboxPauseDeps: SandboxPauseDeps = {
  loadOwnedSandboxRouteRecord,
  resolveLoadedSandboxRouteContext,
  getSandbox,
  updateSandboxRecord,
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
};

export function createSandboxPauseHandler(
  overrides: Partial<SandboxPauseDeps> = {}
) {
  const deps: SandboxPauseDeps = {
    ...defaultSandboxPauseDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const loaded = await deps.loadOwnedSandboxRouteRecord<SandboxPauseRecord>(
      request,
      id,
      {
        select: "*",
        notFoundMessage: "Sandbox not found",
        requireCapability: "tools.bash",
      }
    );
    if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);

    const { record } = loaded;
    if (record.status !== "running") {
      return NextResponse.json(
        { error: "Sandbox is not running" },
        { status: 400 }
      );
    }
    if (record.sandbox_id === "pending") {
      return NextResponse.json(
        { error: "Sandbox is still booting" },
        { status: 409 }
      );
    }

    const resolved = await deps.resolveLoadedSandboxRouteContext(loaded, {
      hydrateSandboxClient: false,
    });
    if (!resolved.ok) return buildSandboxRouteErrorResponse(resolved);

    let snapshotId: string | null;
    let billingClose: Awaited<ReturnType<typeof prepareSandboxBillingClose>> =
      null;
    try {
      billingClose = await deps.prepareSandboxBillingClose(record.id);
    } catch (billingError) {
      console.warn(
        `[sandbox/pause] Billing close preparation failed for ${record.id}; reconciliation will recover:`,
        billingError
      );
    }
    let providerEndedAt: Date;
    try {
      const sandbox = await deps.getSandbox(record.sandbox_id, {
        vercelToken: resolved.context.credentials.vercelToken,
        vercelTeamId: resolved.context.credentials.vercelTeamId,
        vercelProjectId: resolved.context.credentials.vercelProjectId,
      });
      // On a persistent sandbox (v2 SDK), sandbox.stop() auto-snapshots
      // the filesystem and transitions the VM to 'stopped'. A later
      // Sandbox.get({ name, resume: true }) wakes it from the same state.
      // We still capture currentSnapshotId for backward compat with the
      // existing resume-from-snapshot path, which creates a fresh sandbox.
      await sandbox.stop({ blocking: true });
      const providerSession = sandbox.currentSession();
      providerEndedAt =
        providerSession.stoppedAt ?? providerSession.updatedAt ?? new Date();
      snapshotId = sandbox.currentSnapshotId ?? null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to pause sandbox";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    try {
      await deps.finalizeSandboxBillingClose(billingClose, providerEndedAt);
    } catch (billingError) {
      console.warn(
        `[sandbox/pause] VM stopped but billing finalization failed for ${record.id}; reconciliation will retry:`,
        billingError
      );
    }

    // Phase 7 — snapshot_id semantics audit.
    //
    // snapshot_id: still needed. The resume SSE emits a
    // `snapshot_restore` event keyed on this id so the client can show
    // "Restoring from snapshot…" telemetry.
    //
    // snapshot_billing_project_id / snapshot_billing_team_id: only
    // used by the legacy createSandboxFromSnapshot path, which we no
    // longer exercise for persistent records (native resume uses
    // Sandbox.get({ name, resume: true }) under the record's own
    // credentials). Skip those writes for persistent sandboxes so we
    // don't accumulate redundant rows; keep them for non-persistent
    // records where the legacy restore path still runs.
    const updates: Record<string, unknown> = {
      status: "paused",
      health_status: "paused",
      snapshot_id: snapshotId,
    };
    if (!record.persistent) {
      updates.snapshot_billing_project_id =
        record.vercel_project_id ?? record.billing_project_id ?? null;
      updates.snapshot_billing_team_id =
        record.vercel_team_id ?? record.billing_team_id ?? null;
    }

    await deps.updateSandboxRecord(record.id, updates, {
      expectedSandboxId: record.sandbox_id,
      fromStatuses: "running",
    });

    const refreshed =
      await deps.loadOwnedSandboxRouteRecord<SandboxPauseRecord>(request, id, {
        select: "*",
        notFoundMessage: "Sandbox not found",
      });
    if (!refreshed.ok) return buildSandboxRouteErrorResponse(refreshed);

    return NextResponse.json({
      sandbox: toSandboxClientRecord(refreshed.record),
    });
  };
}

export const POST = createSandboxPauseHandler();
