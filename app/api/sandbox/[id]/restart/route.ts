import { NextResponse } from "next/server";
import {
  bootstrapFromSnapshotStreaming,
  getSandbox,
} from "@/lib/sandbox/client";
import {
  ACTIVE_SANDBOX_STATUSES,
  stopSandboxRecord,
  updateSandboxRecord,
} from "@/lib/sandbox/records";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
  loadOwnedSandboxRouteRecord,
  resolveLoadedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import {
  getRepoLinkedVercelProject,
  resolveRepoSandboxEnv,
} from "@/lib/vercel/env-vars";
import { resolveConfiguredDevPort } from "@/lib/repo-settings";
import {
  buildLimitResponse,
  enforceSandboxBootLimits,
  releaseLimitClaim,
} from "@/lib/request-limits";
import {
  buildLifecycleConflictResponse,
  type SandboxLifecycleConflictEvent,
} from "@/lib/sandbox/lifecycle-conflict";
import { isSandboxExplicitlyNonPersistent } from "@/lib/sandbox/persistence";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";
import {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
  presentSandboxBillingAdmissionError,
  requireSandboxBillingSession,
} from "@/lib/billing/sandbox-usage";

// ---- Legacy restart record (non-persistent path, re-POSTs /api/sandbox) ----

type RestartSandboxRecord = {
  id: string;
  repo_id?: string | null;
  sandbox_id: string;
  base_branch?: string | null;
  working_branch?: string | null;
  status: string;
  persistent?: boolean | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

// ---- Persistent restart record (includes repo for in-place bootstrap) ----

type PersistentRestartRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string | null;
  working_branch: string | null;
  status: string;
  health_status: string | null;
  preview_url: string | null;
  snapshot_id: string | null;
  runtime: string | null;
  terminal_cwd: string | null;
  /**
   * Snapshot of the launch-time path; preferred over repo.root_directory
   * so a restarted sandbox boots in the same workspace it was launched at.
   */
  root_directory: string | null;
  persistent: boolean | null;
  created_at: string;
  last_active_at: string | null;
  repo:
    | (Record<string, unknown> & {
        root_directory: string | null;
        dev_command: string | null;
        dev_port: number | null;
        dev_port_auto: unknown;
        runtime?: string | null;
      })
    | null
    | undefined;
};

const PERSISTENT_RESTART_SELECT =
  "id, repo_id, user_id, sandbox_id, base_branch, working_branch, status, stop_reason, health_status, preview_url, snapshot_id, runtime, terminal_cwd, root_directory, persistent, created_at, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, repo:repos(*, workspace:workspaces(*))";

function sseEncode(
  event: SandboxEvent | SandboxLifecycleConflictEvent
): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function stopSandboxAfterLifecycleConflict(
  sandbox: Awaited<ReturnType<typeof getSandbox>>,
  sandboxRecordId: string,
  label: string,
  deps: Pick<
    SandboxRestartDeps,
    "prepareSandboxBillingClose" | "finalizeSandboxBillingClose"
  >
) {
  let billingClose: Awaited<ReturnType<typeof prepareSandboxBillingClose>> =
    null;
  try {
    billingClose = await deps.prepareSandboxBillingClose(sandboxRecordId);
  } catch (billingError) {
    console.warn(
      `[sandbox/restart] Billing close preparation failed after ${label} CAS conflict; reconciliation will recover:`,
      billingError
    );
  }
  let providerEndedAt: Date;
  try {
    await sandbox.stop({ blocking: true });
    // Conflict cleanup is best-effort and also accepts the lightweight
    // handles used by lifecycle recovery tests. Primary lifecycle paths use a
    // fully typed SDK Sandbox and call currentSession directly.
    const providerSession =
      typeof sandbox.currentSession === "function"
        ? sandbox.currentSession()
        : null;
    providerEndedAt =
      providerSession?.stoppedAt ?? providerSession?.updatedAt ?? new Date();
  } catch (stopErr) {
    console.warn(
      `[sandbox/restart] stop() after ${label} CAS conflict surfaced: ${
        stopErr instanceof Error ? stopErr.message : String(stopErr)
      }`
    );
    return;
  }
  try {
    await deps.finalizeSandboxBillingClose(billingClose, providerEndedAt);
  } catch (billingError) {
    console.warn(
      `[sandbox/restart] VM stopped after ${label} CAS conflict, but billing finalization failed; reconciliation will retry:`,
      billingError
    );
  }
}

async function markSandboxRecordNonPersistent(
  deps: Pick<SandboxRestartDeps, "updateSandboxRecord">,
  record: Pick<PersistentRestartRecord, "id" | "sandbox_id">
) {
  try {
    const updated = await deps.updateSandboxRecord(
      record.id,
      { persistent: false },
      { expectedSandboxId: record.sandbox_id }
    );
    if (!updated) {
      console.warn(
        `[sandbox/restart] skipped marking ${record.id} as non-persistent before legacy fallback because the sandbox id changed`
      );
    }
  } catch (error) {
    console.warn(
      `[sandbox/restart] failed to mark ${record.id} as non-persistent before legacy fallback`,
      error
    );
  }
}

const RESTART_INSTALLING_FROM_STATUSES = [
  "creating",
  "installing",
  "running",
  "paused",
  "stopped",
  "error",
] as const;

function buildClientSnapshot(
  record: PersistentRestartRecord,
  overrides: {
    status: string;
    health_status: string;
    preview_url?: string | null;
  }
) {
  return toSandboxClientRecord({
    id: record.id,
    user_id: record.user_id,
    repo_id: record.repo_id,
    sandbox_id: record.sandbox_id,
    base_branch: record.base_branch ?? "main",
    working_branch: record.working_branch ?? record.base_branch ?? "main",
    snapshot_id: record.snapshot_id,
    install_log: null,
    dev_log: null,
    runtime: record.runtime,
    terminal_cwd: record.terminal_cwd,
    root_directory: record.root_directory,
    created_at: record.created_at,
    last_active_at: record.last_active_at,
    status: overrides.status,
    health_status: overrides.health_status,
    preview_url:
      overrides.preview_url === undefined
        ? record.preview_url
        : overrides.preview_url,
    persistent: record.persistent,
  });
}

type SandboxRestartDeps = {
  loadOwnedSandboxRouteRecord: typeof loadOwnedSandboxRouteRecord;
  loadOwnedSandboxRouteContext: typeof loadOwnedSandboxRouteContext;
  resolveLoadedSandboxRouteContext: typeof resolveLoadedSandboxRouteContext;
  getSandbox: typeof getSandbox;
  stopSandboxRecord: typeof stopSandboxRecord;
  updateSandboxRecord: typeof updateSandboxRecord;
  resolveRepoSandboxEnv: typeof resolveRepoSandboxEnv;
  bootstrapFromSnapshotStreaming: typeof bootstrapFromSnapshotStreaming;
  enforceSandboxBootLimits: typeof enforceSandboxBootLimits;
  releaseLimitClaim: typeof releaseLimitClaim;
  fetchImpl: typeof fetch;
  requireSandboxBillingSession: typeof requireSandboxBillingSession;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
};

const defaultSandboxRestartDeps: SandboxRestartDeps = {
  loadOwnedSandboxRouteRecord,
  loadOwnedSandboxRouteContext,
  resolveLoadedSandboxRouteContext,
  getSandbox,
  stopSandboxRecord,
  updateSandboxRecord,
  resolveRepoSandboxEnv,
  bootstrapFromSnapshotStreaming,
  enforceSandboxBootLimits,
  releaseLimitClaim,
  fetchImpl: fetch,
  requireSandboxBillingSession,
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
};

function isActiveSandboxStatus(status: string) {
  return ACTIVE_SANDBOX_STATUSES.includes(
    status as (typeof ACTIVE_SANDBOX_STATUSES)[number]
  );
}

function releaseSandboxBootLimitClaim(
  deps: Pick<SandboxRestartDeps, "releaseLimitClaim">,
  userId: string,
  claimId: string | null
) {
  if (!claimId) return Promise.resolve(false);
  return deps.releaseLimitClaim({
    userId,
    routeKey: "sandbox_boot",
    claimId,
  });
}

/**
 * Native persistent restart: stop the VM to capture a fresh snapshot,
 * then wake the same sandbox with resume:true and re-run the dev
 * bootstrap. Keeps the DB record and the Vercel sandbox name stable.
 */
async function handlePersistentRestart(
  request: Request,
  id: string,
  deps: SandboxRestartDeps
): Promise<Response> {
  const loaded =
    await deps.loadOwnedSandboxRouteContext<PersistentRestartRecord>(
      request,
      id,
      {
        select: PERSISTENT_RESTART_SELECT,
        notFoundMessage: "Sandbox not found",
        hydrateSandboxClient: false,
        requireCapability: "tools.bash",
      }
    );
  if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);

  const { record, auth, context } = loaded;
  if (!record.repo) {
    return NextResponse.json(
      { error: "Sandbox repo not found" },
      { status: 404 }
    );
  }
  if (record.sandbox_id === "pending") {
    return NextResponse.json(
      { error: "Sandbox is still booting" },
      { status: 409 }
    );
  }

  const needsWakeAdmission = !isActiveSandboxStatus(record.status);
  let limitClaimId: string | null = null;
  if (needsWakeAdmission) {
    const limitDecision = await deps.enforceSandboxBootLimits({
      userId: auth.userId,
      repoId: record.repo_id,
    });
    if (!limitDecision.allowed) return buildLimitResponse(limitDecision);
    limitClaimId = limitDecision.claimId ?? null;
  }

  // Step 1: stop the current VM when it is already active
  // (auto-snapshots on persistent), then wake it via resume:true to get a
  // fresh session. Stopped/paused persistent VMs skip stop and must pass
  // active admission before the wake.
  let sandbox;
  try {
    const currentVm = await deps.getSandbox(
      record.sandbox_id,
      context.credentials,
      {
        resume: false,
        onResume: async (resumedSandbox) => {
          await deps.requireSandboxBillingSession(record.id, resumedSandbox);
        },
      }
    );

    if (isSandboxExplicitlyNonPersistent(currentVm)) {
      await releaseSandboxBootLimitClaim(deps, auth.userId, limitClaimId);
      await markSandboxRecordNonPersistent(deps, record);
      return handleLegacyRestart(request, id, deps);
    }

    if (!needsWakeAdmission) {
      // Restart immediately rotates this live provider session. Require the
      // close barrier before stop so scheduled accrual cannot cross sessions.
      await deps.prepareSandboxBillingClose(record.id);
      try {
        await currentVm.stop();
      } catch (stopErr) {
        // Already stopped (e.g. user paused first) is fine; surface anything else.
        console.warn(
          `[sandbox/restart] stop() during persistent restart surfaced: ${
            stopErr instanceof Error ? stopErr.message : String(stopErr)
          }`
        );
      }
    }

    sandbox = await deps.getSandbox(record.sandbox_id, context.credentials, {
      resume: true,
      onResume: async (resumedSandbox) => {
        await deps.requireSandboxBillingSession(record.id, resumedSandbox);
      },
    });
    await deps.requireSandboxBillingSession(record.id, sandbox);
  } catch (err) {
    await releaseSandboxBootLimitClaim(deps, auth.userId, limitClaimId);
    const billingError = presentSandboxBillingAdmissionError(err);
    const message =
      billingError?.message ??
      (err instanceof Error
        ? err.message
        : "Failed to wake sandbox for restart");
    return NextResponse.json(
      { error: message },
      { status: billingError?.status ?? 502 }
    );
  }

  // Step 2: transition the record to installing so UI overlays show
  // the restart-in-progress state. We accept transitions from any
  // active status since user can hit Restart on running/error/idle.
  // Clear stop_reason so a previously-stopped record doesn't carry a
  // stale reason (e.g. "idle_timeout") while it is actively running.
  let installingRecord: PersistentRestartRecord | null;
  try {
    installingRecord = (await deps.updateSandboxRecord(
      record.id,
      {
        ...(limitClaimId ? { limit_claim_id: limitClaimId } : {}),
        status: "installing",
        health_status: "starting",
        stop_reason: null,
        last_active_at: new Date().toISOString(),
      },
      {
        expectedSandboxId: record.sandbox_id,
        fromStatuses: RESTART_INSTALLING_FROM_STATUSES,
        select: PERSISTENT_RESTART_SELECT,
      }
    )) as PersistentRestartRecord | null;
  } catch (error) {
    await releaseSandboxBootLimitClaim(deps, auth.userId, limitClaimId);
    throw error;
  }

  if (!installingRecord) {
    await releaseSandboxBootLimitClaim(deps, auth.userId, limitClaimId);
    await stopSandboxAfterLifecycleConflict(
      sandbox,
      record.id,
      "restart",
      deps
    );
    return buildLifecycleConflictResponse(
      "Sandbox restart was cancelled before it started."
    );
  }

  const repo = record.repo;
  const envResolution = await deps.resolveRepoSandboxEnv({
    repo: repo as unknown as Parameters<
      typeof resolveRepoSandboxEnv
    >[0]["repo"],
    userId: auth.userId,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SandboxEvent | SandboxLifecycleConflictEvent) => {
        controller.enqueue(encoder.encode(sseEncode(event)));
      };

      emit({
        type: "sandbox_created",
        sandboxId: installingRecord.sandbox_id,
        recordId: installingRecord.id,
        sandbox: buildClientSnapshot(installingRecord, {
          status: "installing",
          health_status: "starting",
        }),
      });

      let finalPreviewUrl: string | null = record.preview_url;

      try {
        for await (const bevent of deps.bootstrapFromSnapshotStreaming(
          sandbox,
          {
            // Use the sandbox's snapshot of the launch-time path verbatim.
            // PERSISTENT_RESTART_SELECT always includes root_directory, and
            // the 20260425030000 migration backfilled every existing row,
            // so null here means "explicit repo root", not "missing value".
            // Falling back to repo.root_directory would silently relocate a
            // restarted sandbox into the repo's monorepo subdirectory.
            rootDirectory: record.root_directory,
            devCommand: repo.dev_command,
            devPort: resolveConfiguredDevPort(
              repo.dev_port,
              repo.dev_port_auto
            ),
            envVars: envResolution.envVars,
            envSyncMode: envResolution.sync.mode,
            linkedVercelProject: getRepoLinkedVercelProject(
              repo as unknown as Parameters<
                typeof getRepoLinkedVercelProject
              >[0]
            ),
            runtime: (repo.runtime ??
              record.runtime ??
              "node22") as SandboxRuntime,
          }
        )) {
          switch (bevent.type) {
            case "warning": {
              emit({ type: "warning", message: bevent.message });

              break;
            }
            case "log": {
              emit({
                type: "log",
                phase: bevent.phase,
                data: bevent.data,
              });

              break;
            }
            case "preview_url": {
              finalPreviewUrl = bevent.url;
              const previewRecord = (await deps.updateSandboxRecord(
                record.id,
                {
                  preview_url: bevent.url,
                },
                {
                  expectedSandboxId: record.sandbox_id,
                  fromStatuses: ["installing", "running"],
                  select: PERSISTENT_RESTART_SELECT,
                }
              )) as PersistentRestartRecord | null;
              if (!previewRecord) {
                await stopSandboxAfterLifecycleConflict(
                  sandbox,
                  record.id,
                  "preview",
                  deps
                );
                emit({
                  type: "cancelled",
                  reason: "conflict",
                  message:
                    "Sandbox restart was cancelled before preview became ready.",
                });
                return;
              }
              emit({
                type: "preview_url",
                url: bevent.url,
                sandbox: buildClientSnapshot(previewRecord, {
                  status: previewRecord.status,
                  health_status: previewRecord.health_status ?? "starting",
                  preview_url: bevent.url,
                }),
              });

              break;
            }
            case "status": {
              if (bevent.status === "running") {
                const runningRecord = (await deps.updateSandboxRecord(
                  record.id,
                  {
                    status: "running",
                    health_status: "running",
                    preview_url: finalPreviewUrl,
                    last_active_at: new Date().toISOString(),
                    last_boot_completed_at: new Date().toISOString(),
                  },
                  {
                    expectedSandboxId: record.sandbox_id,
                    fromStatuses: ["installing", "running"],
                    select: PERSISTENT_RESTART_SELECT,
                  }
                )) as PersistentRestartRecord | null;
                if (!runningRecord) {
                  await stopSandboxAfterLifecycleConflict(
                    sandbox,
                    record.id,
                    "running",
                    deps
                  );
                  emit({
                    type: "cancelled",
                    reason: "conflict",
                    message:
                      "Sandbox restart was cancelled before it became ready.",
                  });
                  return;
                }
                const readyRecord = buildClientSnapshot(runningRecord, {
                  status: "running",
                  health_status: "running",
                  preview_url: finalPreviewUrl,
                });
                emit({
                  type: "status",
                  status: "running",
                  sandbox: readyRecord,
                });
                emit({ type: "ready", sandbox: readyRecord });
              }

              break;
            }
            // No default
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Restart bootstrap failed";
        console.error("[sandbox/restart] bootstrap error:", err);
        await stopSandboxAfterLifecycleConflict(
          sandbox,
          record.id,
          "bootstrap failure",
          deps
        );
        const failedRecord = await deps.updateSandboxRecord(
          record.id,
          {
            status: "error",
            health_status: "error",
            last_boot_error: message,
            error: message,
          },
          {
            expectedSandboxId: record.sandbox_id,
            fromStatuses: ["installing", "running"],
          }
        );
        if (!failedRecord) {
          emit({
            type: "cancelled",
            reason: "conflict",
            message: "Sandbox restart failed after it was cancelled.",
          });
          return;
        }
        emit({ type: "error", message, phase: "dev" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Legacy non-persistent restart: snapshot the VM, retire the record,
 * then POST a new launch with restoreSnapshotId. Kept for sandboxes
 * created before the persistent migration, or with the kill switch
 * enabled.
 */
async function handleLegacyRestart(
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

export function createSandboxRestartHandler(
  overrides: Partial<SandboxRestartDeps> = {}
) {
  const deps: SandboxRestartDeps = {
    ...defaultSandboxRestartDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;

    // Cheap probe to branch persistent vs. legacy without loading the
    // full repo relation for both paths.
    const probe = await deps.loadOwnedSandboxRouteRecord<{
      id: string;
      sandbox_id: string;
      persistent?: boolean | null;
    }>(request, id, {
      select: "id, sandbox_id, persistent",
      notFoundMessage: "Sandbox not found",
    });
    if (!probe.ok) return buildSandboxRouteErrorResponse(probe);

    if (probe.record.persistent) {
      return handlePersistentRestart(request, id, deps);
    }
    return handleLegacyRestart(request, id, deps);
  };
}

export const POST = createSandboxRestartHandler();
