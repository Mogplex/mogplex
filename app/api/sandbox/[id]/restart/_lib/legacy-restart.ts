import { NextResponse } from "next/server";
import { getCanonicalAppUrl } from "@/lib/app-url";
import {
  ACTIVE_TEAM_HEADER,
  readActiveTeamIdHeader,
} from "@/lib/team-capabilities";
import { buildSandboxRouteErrorResponse } from "@/lib/sandbox/route-context";
import { buildLifecycleConflictResponse } from "@/lib/sandbox/lifecycle-conflict";
import type { RestartSandboxRecord, SandboxRestartDeps } from "./types";
import {
  captureLegacyWorkspaceSnapshot,
  LegacySnapshotError,
} from "./legacy-snapshot";

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
  const loadRecord = (scopedRequest: Request) =>
    deps.loadOwnedSandboxRouteRecord<RestartSandboxRecord>(scopedRequest, id, {
      select:
        "id, repo_id, product_team_id, sandbox_id, base_branch, working_branch, root_directory, status, persistent, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id",
      notFoundMessage: "Sandbox not found",
      requireCapability: "tools.bash",
    });
  let loaded = await loadRecord(request);
  if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);
  const teamId = loaded.record.product_team_id ?? null;
  if (teamId && teamId !== readActiveTeamIdHeader(request)) {
    // Credentials for the request's scope cannot authorize a different saved
    // team. Resolve that team's role again before touching its provider session.
    const headers = new Headers(request.headers);
    headers.set(ACTIVE_TEAM_HEADER, teamId);
    loaded = await loadRecord(
      new Request(request.url, { method: request.method, headers })
    );
    if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);
    if (loaded.record.product_team_id !== teamId) {
      return buildLifecycleConflictResponse(
        "Workspace access changed. Try again."
      );
    }
  }
  const { record } = loaded;
  if (record.status === "pausing") {
    return buildLifecycleConflictResponse(
      "Sandbox is pausing. Wait for pause to finish before restarting."
    );
  }
  if (!record.repo_id)
    return NextResponse.json({ error: "Sandbox not found" }, { status: 404 });
  if (record.sandbox_id === "pending") {
    return NextResponse.json(
      { error: "Sandbox is still booting" },
      { status: 409 }
    );
  }

  const requestUrl = new URL(request.url);
  const internalRequest =
    requestUrl.hostname === "mogplex.internal" ||
    requestUrl.hostname === "internal.mogplex";
  let origin: string;
  try {
    origin = getCanonicalAppUrl(internalRequest ? undefined : request).origin;
  } catch {
    console.error(
      "[sandbox/restart] Configure APP_URL, NEXT_PUBLIC_APP_URL, or VERCEL_URL"
    );
    return NextResponse.json(
      { error: "The sandbox service is not available. Try again later." },
      { status: 503 }
    );
  }

  const snapshotProjectId =
    record.vercel_project_id ?? record.billing_project_id ?? null;
  const snapshotTeamId =
    record.vercel_team_id ?? record.billing_team_id ?? null;
  let restoreSnapshotId: string | null;
  const resolved = await deps.resolveLoadedSandboxRouteContext(loaded, {
    hydrateSandboxClient: false,
  });
  if (!resolved.ok) return buildSandboxRouteErrorResponse(resolved);
  try {
    restoreSnapshotId = await captureLegacyWorkspaceSnapshot({
      deps,
      recordId: record.id,
      sandboxId: record.sandbox_id,
      snapshotProjectId,
      snapshotTeamId,
      credentials: {
        vercelToken: resolved.context.credentials.vercelToken,
        vercelTeamId: resolved.context.credentials.vercelTeamId,
        vercelProjectId: resolved.context.credentials.vercelProjectId,
      },
    });
  } catch (error) {
    if (error instanceof LegacySnapshotError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error("[sandbox/restart] Snapshot billing recovery failed", {
      sandboxRecordId: record.id,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "The sandbox service is not available. Try again later." },
      { status: 503 }
    );
  }
  if (!restoreSnapshotId) {
    return NextResponse.json(
      {
        error: "Saved workspace is unavailable. Contact support for recovery.",
      },
      { status: 409 }
    );
  }

  const stopped = await deps.stopSandboxRecord(record.id, {
    expectedSandboxId: record.sandbox_id,
    healthStatus: "stopped",
    stopReason: "manual",
  });
  if (!stopped) {
    return buildLifecycleConflictResponse("Workspace changed. Try again.");
  }

  const launchResponse = await deps.fetchImpl(`${origin}/api/sandbox`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") || "",
      ...(teamId ? { [ACTIVE_TEAM_HEADER]: teamId } : {}),
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
      ...(loaded.rootDirectory === undefined
        ? {}
        : { rootDirectory: loaded.rootDirectory }),
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
