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
import { NextResponse } from "next/server";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";
import { presentSandboxBillingAdmissionError } from "@/lib/billing/sandbox-usage";

import type { SandboxResumeRecord, SandboxResumeDeps } from "./_lib/types";
import { RESUME_SELECT, defaultSandboxResumeDeps } from "./_lib/constants";
import {
  buildClientSnapshot,
  sseEncode,
  stopSandboxAfterLifecycleConflict,
  releaseSandboxBootLimitClaim,
} from "./_lib/helpers";

export function createSandboxResumeHandler(
  overrides: Partial<SandboxResumeDeps> = {}
) {
  const deps: SandboxResumeDeps = {
    ...defaultSandboxResumeDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;

    // Load record + repo + credentials in one pass. hydrateSandboxClient
    // is false because Sandbox.get with resume:false wouldn't wake the
    // paused VM — we call it manually with resume:true below.
    const loaded = await deps.loadOwnedSandboxRouteContext<SandboxResumeRecord>(
      request,
      id,
      {
        select: RESUME_SELECT,
        notFoundMessage: "Sandbox not found",
        hydrateSandboxClient: false,
        requireCapability: "tools.bash",
      }
    );
    if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);

    const { record, auth, context } = loaded;
    if (record.status === "pausing") {
      return NextResponse.json(
        {
          error:
            "Sandbox is pausing. Wait for pause to finish, or stop the sandbox to recover.",
        },
        { status: 409 }
      );
    }
    if (record.status !== "paused") {
      return NextResponse.json(
        { error: "Sandbox is not paused" },
        { status: 400 }
      );
    }
    if (!record.persistent) {
      return NextResponse.json(
        {
          error:
            "Sandbox is not persistent — use the legacy snapshot-restore launch path instead.",
        },
        { status: 400 }
      );
    }
    if (record.sandbox_id === "pending") {
      return NextResponse.json(
        { error: "Sandbox is not ready to resume" },
        { status: 409 }
      );
    }
    if (!record.repo) {
      return NextResponse.json(
        { error: "Sandbox repo not found" },
        { status: 404 }
      );
    }

    const limitDecision = await deps.enforceSandboxBootLimits({
      userId: auth.userId,
      repoId: record.repo_id,
    });
    if (!limitDecision.allowed) return buildLimitResponse(limitDecision);
    const limitClaimId = limitDecision.claimId ?? null;

    // Wake the VM. Filesystem is restored from the auto-snapshot; the
    // dev server process is not — we restart it via bootstrap below.
    const sandbox = await deps
      .getSandbox(record.sandbox_id, context.credentials, {
        resume: true,
        onResume: async (resumedSandbox) => {
          await deps.requireSandboxBillingSession(record.id, resumedSandbox);
        },
      })
      .catch((err: unknown) => {
        const billingError = presentSandboxBillingAdmissionError(err);
        return {
          __error:
            billingError?.message ??
            (err instanceof Error ? err.message : "Failed to resume sandbox"),
          __status: billingError?.status ?? 502,
        } as const;
      });

    if ("__error" in sandbox) {
      await releaseSandboxBootLimitClaim(deps, auth.userId, limitClaimId);
      return NextResponse.json(
        { error: sandbox.__error },
        { status: sandbox.__status }
      );
    }

    try {
      await deps.requireSandboxBillingSession(record.id, sandbox);
    } catch (error) {
      await releaseSandboxBootLimitClaim(deps, auth.userId, limitClaimId);
      const billingError = presentSandboxBillingAdmissionError(error);
      return NextResponse.json(
        {
          error:
            billingError?.message ??
            "Sandbox billing is temporarily unavailable",
        },
        { status: billingError?.status ?? 503 }
      );
    }

    // Transition to installing so UI overlays/spinners kick in while
    // the dev server restarts. Clear stop_reason so a previously-stopped
    // record doesn't carry a stale reason while it is actively running.
    let installingRecord: SandboxResumeRecord | null;
    try {
      installingRecord = (await deps.updateSandboxRecord(
        record.id,
        {
          limit_claim_id: limitClaimId,
          status: "installing",
          health_status: "starting",
          stop_reason: null,
          last_active_at: new Date().toISOString(),
        },
        {
          expectedSandboxId: record.sandbox_id,
          fromStatuses: "paused",
          select: RESUME_SELECT,
        }
      )) as SandboxResumeRecord | null;
    } catch (error) {
      await releaseSandboxBootLimitClaim(deps, auth.userId, limitClaimId);
      throw error;
    }

    if (!installingRecord) {
      await releaseSandboxBootLimitClaim(deps, auth.userId, limitClaimId);
      await stopSandboxAfterLifecycleConflict(
        sandbox,
        record.id,
        "resume",
        deps
      );
      return buildLifecycleConflictResponse(
        "Sandbox resume was cancelled before it started."
      );
    }

    if (record.stop_reason === "auto_pause") {
      const lastActiveMs = record.last_active_at
        ? new Date(record.last_active_at).getTime()
        : NaN;
      await deps
        .recordSandboxLifecycleEvent({
          sandboxRecordId: record.id,
          userId: auth.userId,
          eventType: "resume_after_auto_pause",
          payload: {
            sandbox_id: record.sandbox_id,
            pause_duration_ms: Number.isFinite(lastActiveMs)
              ? Math.max(0, Date.now() - lastActiveMs)
              : null,
          },
        })
        .catch((error) => {
          console.warn(
            "[sandbox/resume] failed to record auto-pause resume event:",
            error
          );
        });
    }

    const repo = record.repo;
    // resolveRepoSandboxEnv + getRepoLinkedVercelProject accept narrow
    // subsets of the Repo shape; Supabase returns the row typed as
    // Record<string, unknown> via the wildcard select so we cast at
    // the boundary.
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

        // Seed the client with the current record so it can bind UI
        // state to this recordId before bootstrap logs start streaming.
        emit({
          type: "sandbox_created",
          sandboxId: installingRecord.sandbox_id,
          recordId: installingRecord.id,
          sandbox: buildClientSnapshot(installingRecord, {
            status: "installing",
            health_status: "starting",
          }),
        });

        if (record.snapshot_id) {
          emit({ type: "snapshot_restore", snapshotId: record.snapshot_id });
        }

        let finalPreviewUrl: string | null = record.preview_url;

        try {
          for await (const bevent of deps.bootstrapFromSnapshotStreaming(
            sandbox,
            {
              // Use the sandbox's snapshot of the launch-time path verbatim.
              // RESUME_SELECT always includes root_directory, and the
              // 20260425030000 migration backfilled every existing row, so
              // null here means "explicit repo root", not "missing value".
              // Falling back to repo.root_directory would silently relocate
              // a resumed sandbox into the repo's monorepo subdirectory.
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
                    select: RESUME_SELECT,
                  }
                )) as SandboxResumeRecord | null;
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
                      "Sandbox resume was cancelled before preview became ready.",
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
                      select: RESUME_SELECT,
                    }
                  )) as SandboxResumeRecord | null;
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
                        "Sandbox resume was cancelled before it became ready.",
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
            err instanceof Error ? err.message : "Resume bootstrap failed";
          console.error("[sandbox/resume] bootstrap error:", err);
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
              message: "Sandbox resume failed after it was cancelled.",
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
  };
}

export const POST = createSandboxResumeHandler();
