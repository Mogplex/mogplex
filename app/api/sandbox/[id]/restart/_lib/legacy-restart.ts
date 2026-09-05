import { NextResponse } from "next/server";
import { buildSandboxRouteErrorResponse } from "@/lib/sandbox/route-context";
import { buildLifecycleConflictResponse } from "@/lib/sandbox/lifecycle-conflict";
import type { RestartSandboxRecord, SandboxRestartDeps } from "./types";

/**
 * Legacy non-persistent restart: snapshot the VM, retire the record,
 * then POST a new launch with restoreSnapshotId. Kept for sandboxes
 * created before the persistent migration, or with the kill switch
 * enabled.
 */
export async function handleLegacyRestart(
  request: Request,
  id: string,
  deps: SandboxRestartDeps
): Promise<Response> {
  const loaded = await deps.loadOwnedSandboxRouteRecord<RestartSandboxRecord>(
    request,
    id,
    {
      select:
        "id, repo_id, sandbox_id, base_branch, working_branch, status, persistent, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id",
      notFoundMessage: "Sandbox not found",
      requireCapability: "tools.bash",
    }
  );
  if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);
  const { record } = loaded;
  if (record.status === "pausing") {
    return buildLifecycleConflictResponse(
      "Sandbox is pausing. Wait for pause to finish before restarting."
    );
  }
  if (!record.repo_id)
    return NextResponse.json({ error: "Sandbox not found" }, { status: 404 });

  let restoreSnapshotId: string | null = null;
  const resolved = await deps.resolveLoadedSandboxRouteContext(loaded, {
    hydrateSandboxClient: false,
  });
  if (resolved.ok && record.sandbox_id !== "pending") {
    try {
      const sandbox = await deps.getSandbox(
        record.sandbox_id,
        {
          vercelToken: resolved.context.credentials.vercelToken,
          vercelTeamId: resolved.context.credentials.vercelTeamId,
          vercelProjectId: resolved.context.credentials.vercelProjectId,
        },
        {
          resume: false,
          onResume: async (resumedSandbox) => {
            await deps.requireSandboxBillingSession(record.id, resumedSandbox);
          },
        }
      );
      await deps.prepareSandboxBillingClose(record.id);
      try {
        const snapshot = await sandbox.snapshot();
        restoreSnapshotId = snapshot.snapshotId;
      } catch {
        await sandbox.stop();
      }
    } catch {
      // Already stopped or destroyed.
    }
  }

  await deps.stopSandboxRecord(record.id, {
    expectedSandboxId: record.sandbox_id,
    healthStatus: "stopped",
    stopReason: "manual",
  });

  const snapshotProjectId =
    record.vercel_project_id ?? record.billing_project_id ?? null;
  const snapshotTeamId =
    record.vercel_team_id ?? record.billing_team_id ?? null;

  if (restoreSnapshotId) {
    try {
      await deps.updateSandboxRecord(record.id, {
        snapshot_id: restoreSnapshotId,
        snapshot_billing_project_id: snapshotProjectId,
        snapshot_billing_team_id: snapshotTeamId,
      });
    } catch (error) {
      console.error(
        "[sandbox/restart] Failed to persist snapshot metadata:",
        error
      );
    }
  }

  const { origin } = new URL(request.url);
  const launchResponse = await deps.fetchImpl(`${origin}/api/sandbox`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") || "",
      ...(request.headers.get("authorization")
        ? { Authorization: request.headers.get("authorization")! }
        : {}),
      ...(request.headers.get("x-delegated-user-id")
        ? {
            "X-Delegated-User-Id": request.headers.get("x-delegated-user-id")!,
          }
        : {}),
    },
    body: JSON.stringify({
      repoId: record.repo_id,
      baseBranch: record.base_branch,
      workingBranch: record.working_branch,
      createBranch: false,
      ...(restoreSnapshotId
        ? {
            restoreSnapshotId,
            restoreSnapshotProjectId: snapshotProjectId,
            restoreSnapshotTeamId: snapshotTeamId,
          }
        : {}),
    }),
    cache: "no-store",
  });

  const contentType =
    launchResponse.headers.get("Content-Type") || "application/json";
  return new Response(launchResponse.body, {
    status: launchResponse.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control":
        launchResponse.headers.get("Cache-Control") || "no-cache",
      Connection: launchResponse.headers.get("Connection") || "keep-alive",
    },
  });
}
