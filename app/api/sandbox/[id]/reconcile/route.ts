import { NextResponse } from "next/server";
import {
  reconcileSandboxReadiness,
  startSandboxReadinessReconciliation,
} from "@/lib/sandbox/readiness-reconciliation";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteRecord,
} from "@/lib/sandbox/route-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const loaded = await loadOwnedSandboxRouteRecord(request, id, {
    select: "id, sandbox_id",
    requireCapability: "tools.bash",
  });
  if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);

  const queued = await startSandboxReadinessReconciliation({
    sandboxRecordId: id,
    expectedSandboxId: loaded.record.sandbox_id,
    source: "manual",
  });

  if (queued.queued) {
    return NextResponse.json({
      queued: true,
      runtimeProvider: queued.runtimeProvider,
      runtimeRunId: queued.runtimeRunId,
    });
  }

  const reconciled = await reconcileSandboxReadiness(
    {
      sandboxRecordId: id,
      expectedSandboxId: loaded.record.sandbox_id,
      source: "manual",
    },
    {
      includeDiagnostics: true,
    }
  );

  return NextResponse.json({
    queued: false,
    reason: queued.reason,
    sandbox: reconciled?.sandbox ?? null,
  });
}
