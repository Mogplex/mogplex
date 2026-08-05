import {
  getSandbox,
  bootstrapFromSnapshotStreaming,
} from "@/lib/sandbox/client";
import { updateSandboxRecord } from "@/lib/sandbox/records";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
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
import { recordSandboxLifecycleEvent } from "@/lib/sandbox/auto-pause";
import { NextResponse } from "next/server";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";
import {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
  presentSandboxBillingAdmissionError,
  requireSandboxBillingSession,
} from "@/lib/billing/sandbox-usage";

/**
 * toSandboxClientRecord expects non-null base_branch/working_branch. Our
 * record columns are NOT NULL in practice, but the type stays nullable
 * to match the DB schema — this helper normalizes for the client cast.
 */
function buildClientSnapshot(
  record: SandboxResumeRecord,
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

// Full repo + workspace select — resolveRepoSandboxEnv and the bootstrap
// helpers read env vars, dev command, runtime, and the workspace's
// inherited Vercel project link.
const RESUME_SELECT =
  "id, repo_id, user_id, sandbox_id, base_branch, working_branch, status, stop_reason, health_status, preview_url, snapshot_id, snapshot_billing_project_id, snapshot_billing_team_id, install_log, dev_log, runtime, terminal_cwd, root_directory, error, last_preview_error, last_boot_error, created_at, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, persistent, repo:repos(*, workspace:workspaces(*))";

type SandboxResumeRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string | null;
  working_branch: string | null;
  status: string;
  stop_reason: string | null;
  health_status: string | null;
  preview_url: string | null;
  snapshot_id: string | null;
  runtime: string | null;
  terminal_cwd: string | null;
  /**
   * Snapshot of the launch-time path; preferred over repo.root_directory
   * so resuming a sandbox boots the dev server in the same workspace it
   * was originally launched at.
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

type SandboxResumeDeps = {
  loadOwnedSandboxRouteContext: typeof loadOwnedSandboxRouteContext;
  getSandbox: typeof getSandbox;
  updateSandboxRecord: typeof updateSandboxRecord;
  resolveRepoSandboxEnv: typeof resolveRepoSandboxEnv;
  bootstrapFromSnapshotStreaming: typeof bootstrapFromSnapshotStreaming;
  enforceSandboxBootLimits: typeof enforceSandboxBootLimits;
  releaseLimitClaim: typeof releaseLimitClaim;
  recordSandboxLifecycleEvent: typeof recordSandboxLifecycleEvent;
  requireSandboxBillingSession: typeof requireSandboxBillingSession;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
};

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
    SandboxResumeDeps,
    "prepareSandboxBillingClose" | "finalizeSandboxBillingClose"
  >
) {
  let billingClose: Awaited<ReturnType<typeof prepareSandboxBillingClose>> =
    null;
  try {
    billingClose = await deps.prepareSandboxBillingClose(sandboxRecordId);
  } catch (billingError) {
    console.warn(
      `[sandbox/resume] Billing close preparation failed after ${label} CAS conflict; reconciliation will recover:`,
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
      `[sandbox/resume] stop() after ${label} CAS conflict surfaced: ${
        stopErr instanceof Error ? stopErr.message : String(stopErr)
      }`
    );
    return;
  }
  try {
    await deps.finalizeSandboxBillingClose(billingClose, providerEndedAt);
  } catch (billingError) {
    console.warn(
      `[sandbox/resume] VM stopped after ${label} CAS conflict, but billing finalization failed; reconciliation will retry:`,
      billingError
    );
  }
}

const defaultSandboxResumeDeps: SandboxResumeDeps = {
  loadOwnedSandboxRouteContext,
  getSandbox,
  updateSandboxRecord,
  resolveRepoSandboxEnv,
  bootstrapFromSnapshotStreaming,
  enforceSandboxBootLimits,
  releaseLimitClaim,
  recordSandboxLifecycleEvent,
  requireSandboxBillingSession,
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
};

function releaseSandboxBootLimitClaim(
  deps: Pick<SandboxResumeDeps, "releaseLimitClaim">,
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
