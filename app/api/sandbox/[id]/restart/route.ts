import { NextResponse } from "next/server";
import { buildSandboxRouteErrorResponse } from "@/lib/sandbox/route-context";
import {
  getRepoLinkedVercelProject,
  resolveRepoSandboxEnv,
} from "@/lib/vercel/env-vars";
import { resolveConfiguredDevPort } from "@/lib/repo-settings";
import { buildLimitResponse } from "@/lib/request-limits";
import {
  buildLifecycleConflictResponse,
  type SandboxLifecycleConflictEvent,
} from "@/lib/sandbox/lifecycle-conflict";
import { isSandboxExplicitlyNonPersistent } from "@/lib/sandbox/persistence";
import { isNotFoundError } from "@/lib/sandbox/sdk-adapter";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";
import { presentSandboxBillingAdmissionError } from "@/lib/billing/sandbox-usage";

import type { PersistentRestartRecord, SandboxRestartDeps } from "./_lib/types";
import {
  PERSISTENT_RESTART_SELECT,
  RESTART_INSTALLING_FROM_STATUSES,
  defaultSandboxRestartDeps,
} from "./_lib/constants";
import {
  sseEncode,
  stopSandboxAfterLifecycleConflict,
  markSandboxRecordNonPersistent,
  buildClientSnapshot,
  isActiveSandboxStatus,
  releaseSandboxBootLimitClaim,
} from "./_lib/helpers";
import { handleLegacyRestart } from "./_lib/legacy-restart";

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
  if (record.status === "pausing") {
    return buildLifecycleConflictResponse(
      "Sandbox is pausing. Wait for pause to finish before restarting."
    );
  }
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
      const billingClose = await deps.prepareSandboxBillingClose(record.id);
      let stopSucceeded = false;
      try {
        await currentVm.stop({ blocking: true });
        stopSucceeded = true;
      } catch (stopErr) {
        // Already stopped (e.g. user paused first) is fine; surface anything else.
        console.warn(
          `[sandbox/restart] stop() during persistent restart surfaced: ${
            stopErr instanceof Error ? stopErr.message : String(stopErr)
          }`
        );
      }
      if (stopSucceeded) {
        const providerSession = currentVm.currentSession();
        const providerEndedAt =
          providerSession.stoppedAt ?? providerSession.updatedAt ?? new Date();
        // Finalize before waking the replacement so stopped boot time can
        // never be charged to the predecessor. Failure remains fail-closed:
        // the VM is stopped and reconciliation can finish this generation.
        await deps.finalizeSandboxBillingClose(billingClose, providerEndedAt);
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
    if (isNotFoundError(err)) {
      // Vercel no longer has a resumable sandbox behind this name (its last
      // session and snapshot expired). Nothing can be woken, so retire the
      // record and relaunch through the collection route, which reconciles
      // the stale provider name before creating a replacement.
      console.info(
        "[sandbox/restart] provider sandbox gone; relaunching through legacy restart",
        { sandboxRecordId: record.id, sandboxId: record.sandbox_id }
      );
      return handleLegacyRestart(request, id, deps);
    }
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
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SandboxEvent | SandboxLifecycleConflictEvent) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(sseEncode(event)));
        } catch {
          cancelled = true;
        }
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
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      // Agent callers return after the first sandbox_created event while the
      // server continues bootstrap. Keep the lifecycle work running without
      // writing additional events to a closed response stream.
      cancelled = true;
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
      status: string;
    }>(request, id, {
      select: "id, sandbox_id, persistent, status",
      notFoundMessage: "Sandbox not found",
    });
    if (!probe.ok) return buildSandboxRouteErrorResponse(probe);
    if (probe.record.status === "pausing") {
      return buildLifecycleConflictResponse(
        "Sandbox is pausing. Wait for pause to finish before restarting."
      );
    }

    if (probe.record.persistent) {
      return handlePersistentRestart(request, id, deps);
    }
    return handleLegacyRestart(request, id, deps);
  };
}

export const POST = createSandboxRestartHandler();
