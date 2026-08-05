import { NextResponse } from "next/server";
import { getSandbox, previewAllowsRoot404 } from "@/lib/sandbox/client";
import {
  resolveSandboxPath,
  resolveSandboxRootDirectory,
} from "@/lib/repo-settings";
import { checkSandboxHealth } from "@/lib/sandbox/health-status";
import { updateSandboxRecord } from "@/lib/sandbox/records";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
  loadOwnedSandboxRouteRecord,
} from "@/lib/sandbox/route-context";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { loadSandboxVercelDiagnostics } from "@/lib/vercel/load-sandbox-diagnostics";
import { reconcileSandboxReadiness } from "@/lib/sandbox/readiness-reconciliation";
import type { VercelAuthMode } from "@/lib/vercel/service";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes/types";
import {
  createSandboxBillingOnResume,
  sandboxBillingAdmissionHttpStatus,
} from "@/lib/billing/sandbox-usage";

type SandboxHealthRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  snapshot_id?: string | null;
  preview_url: string | null;
  install_log?: string | null;
  dev_log?: string | null;
  runtime?: string | null;
  terminal_cwd?: string | null;
  // Per-launch path snapshot. Declared here so the type stays
  // aligned with SANDBOX_HEALTH_ROUTE_SELECT — if a future change
  // strips this column from the SELECT string, the type
  // disagreement will surface at compile time rather than as a
  // silent runtime regression in readDevLog.
  root_directory?: string | null;
  health_status?: string | null;
  last_health_check_at?: string | null;
  last_active_at?: string | null;
  status: string;
  last_preview_http_status?: number | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  boot_attempts?: number | null;
  last_boot_started_at?: string | null;
  last_boot_completed_at?: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  error?: string | null;
  created_at: string;
  repo?:
    | { root_directory?: string | null }
    | { root_directory?: string | null }[]
    | null;
};

const SANDBOX_HEALTH_ROUTE_SELECT =
  "id, user_id, repo_id, sandbox_id, base_branch, working_branch, snapshot_id, stop_reason, preview_url, install_log, dev_log, runtime, terminal_cwd, root_directory, health_status, last_health_check_at, last_active_at, status, last_preview_http_status, last_preview_error, last_boot_error, boot_attempts, last_boot_started_at, last_boot_completed_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, error, created_at, repo:repos(root_directory)";

type SandboxHealthCredentials = {
  vercelToken: string;
  vercelTeamId?: string | null;
  vercelProjectId: string;
};

type SandboxRuntimeState = {
  status: string;
};

type SandboxHealthDiagnostics = Awaited<
  ReturnType<typeof loadSandboxVercelDiagnostics>
>;

type RefreshedCompatibilityHealth = {
  nextRecord: SandboxHealthRecord;
  vercelDiagnostics: SandboxHealthDiagnostics | null;
};

async function readDevLog(
  record: {
    id: string;
    sandbox_id: string;
    root_directory?: string | null;
    repo?:
      | { root_directory?: string | null }
      | { root_directory?: string | null }[]
      | null;
  },
  credentials: {
    vercelToken: string;
    vercelTeamId?: string | null;
    vercelProjectId: string;
  }
) {
  const repo = Array.isArray(record.repo) ? record.repo[0] : record.repo;
  const sandbox = await getSandbox(
    record.sandbox_id,
    {
      vercelToken: credentials.vercelToken,
      vercelTeamId: credentials.vercelTeamId,
      vercelProjectId: credentials.vercelProjectId,
    },
    { onResume: createSandboxBillingOnResume(record.id) }
  );

  // Read dev.log from the workspace the sandbox actually booted in,
  // not the repo's persistent default. A monorepo user who launched
  // at apps/admin would otherwise read packages/api/.mogplex/dev.log
  // (or 404), giving the health panel an empty log even when the
  // dev server is happily writing logs at the right path.
  const rootDirectory = resolveSandboxRootDirectory(
    record,
    repo as { root_directory?: string | null } | null | undefined
  );
  const path = resolveSandboxPath(rootDirectory, ".mogplex/dev.log");
  const log = await sandbox.readFile({ path });
  return typeof log === "string" ? log : "";
}

export type SandboxHealthGetDeps = {
  loadOwnedSandboxRouteContext: typeof loadOwnedSandboxRouteContext;
  readDevLog: typeof readDevLog;
  checkSandboxHealth: typeof checkSandboxHealth;
  loadVercelDiagnostics: typeof loadSandboxVercelDiagnostics;
  updateSandboxRecord: typeof updateSandboxRecord;
  loadLatestSandboxRecord: (id: string) => Promise<SandboxHealthRecord | null>;
};

const defaultSandboxHealthGetDeps: SandboxHealthGetDeps = {
  loadOwnedSandboxRouteContext,
  readDevLog,
  checkSandboxHealth,
  loadVercelDiagnostics: loadSandboxVercelDiagnostics,
  updateSandboxRecord,
  async loadLatestSandboxRecord(id: string) {
    const result = await reconcileSandboxReadiness(
      {
        sandboxRecordId: id,
        source: "health",
      },
      {
        includeDiagnostics: true,
      }
    );

    return result?.rawRecord ?? null;
  },
};

function shouldRefreshCompatibilityHealthRecord(
  record: SandboxHealthRecord,
  sandbox: SandboxRuntimeState | null | undefined
) {
  return record.sandbox_id !== "pending" && Boolean(sandbox);
}

async function readCompatibilityDevLog(
  deps: Pick<SandboxHealthGetDeps, "readDevLog">,
  record: SandboxHealthRecord,
  credentials: SandboxHealthCredentials
) {
  try {
    return await deps.readDevLog(record, credentials);
  } catch (error) {
    if (sandboxBillingAdmissionHttpStatus(error)) throw error;
    return record.dev_log || "";
  }
}

function resolveCompatibilitySandboxStatus(input: {
  recordStatus: string;
  sandboxStatus: string;
  healthStatus: string;
}) {
  if (input.healthStatus === "stopped") return "stopped";
  if (
    input.sandboxStatus === "running" ||
    input.healthStatus !== "not_available"
  ) {
    return "running";
  }
  return input.recordStatus;
}

function resolveCompatibilityHealthStatus(
  recordHealthStatus: string | null | undefined,
  healthStatus: string
) {
  if (recordHealthStatus === "idle_warning" && healthStatus === "running") {
    return "idle_warning";
  }
  return healthStatus;
}

function resolveCompatibilityPreviewError(input: {
  healthStatus: string;
  message: string | null | undefined;
}) {
  if (
    input.healthStatus === "running" ||
    input.healthStatus === "idle_warning"
  ) {
    return null;
  }
  return input.message ?? null;
}

function buildCompatibilityHealthRecord(input: {
  record: SandboxHealthRecord;
  sandboxStatus: string;
  devLog: string;
  health: Awaited<ReturnType<typeof checkSandboxHealth>>;
}) {
  const nextStatus = resolveCompatibilitySandboxStatus({
    recordStatus: input.record.status,
    sandboxStatus: input.sandboxStatus,
    healthStatus: input.health.status,
  });

  return {
    ...input.record,
    dev_log: input.devLog,
    status: nextStatus,
    health_status: resolveCompatibilityHealthStatus(
      input.record.health_status,
      input.health.status
    ),
    last_health_check_at: new Date().toISOString(),
    last_preview_http_status: input.health.statusCode ?? null,
    last_preview_error: resolveCompatibilityPreviewError({
      healthStatus: input.health.status,
      message: input.health.message,
    }),
    error: nextStatus === "running" ? null : input.record.error,
  };
}

async function loadCompatibilityVercelDiagnostics(input: {
  deps: Pick<SandboxHealthGetDeps, "loadVercelDiagnostics">;
  credentialSource: "platform" | "user";
  credentials: SandboxHealthCredentials;
  healthStatus: string;
}) {
  try {
    const vercelDiagnostics = await input.deps.loadVercelDiagnostics({
      authMode: (input.credentialSource === "user"
        ? "personal"
        : "platform") as VercelAuthMode,
      vercelToken: input.credentials.vercelToken,
      teamId: input.credentials.vercelTeamId,
      projectId: input.credentials.vercelProjectId,
    });

    const previewError =
      input.healthStatus !== "running" &&
      input.healthStatus !== "idle_warning" &&
      vercelDiagnostics?.buildSummary
        ? vercelDiagnostics.buildSummary
        : null;

    return { vercelDiagnostics, previewError };
  } catch {
    return {
      vercelDiagnostics: null,
      previewError: null,
    };
  }
}

async function persistCompatibilityHealthRecord(
  deps: Pick<SandboxHealthGetDeps, "updateSandboxRecord">,
  record: SandboxHealthRecord,
  nextRecord: SandboxHealthRecord
) {
  await deps.updateSandboxRecord(
    record.id,
    {
      status: nextRecord.status,
      health_status: nextRecord.health_status,
      dev_log: nextRecord.dev_log,
      last_health_check_at: nextRecord.last_health_check_at,
      last_preview_http_status: nextRecord.last_preview_http_status,
      last_preview_error: nextRecord.last_preview_error,
      error: nextRecord.error,
    },
    {
      expectedSandboxId: record.sandbox_id,
      fromStatuses: ["creating", "installing", "running"],
    }
  );
}

async function refreshCompatibilitySandboxHealth(input: {
  deps: SandboxHealthGetDeps;
  record: SandboxHealthRecord;
  sandbox: SandboxRuntimeState | null | undefined;
  credentials: SandboxHealthCredentials;
  credentialSource: "platform" | "user";
}): Promise<RefreshedCompatibilityHealth> {
  if (!shouldRefreshCompatibilityHealthRecord(input.record, input.sandbox)) {
    return {
      nextRecord: { ...input.record },
      vercelDiagnostics: null,
    };
  }

  const devLog = await readCompatibilityDevLog(
    input.deps,
    input.record,
    input.credentials
  );
  const health = await input.deps.checkSandboxHealth(
    input.record.preview_url,
    {
      sandboxId: input.record.sandbox_id,
      token: input.credentials.vercelToken,
      projectId: input.credentials.vercelProjectId,
      teamId: input.credentials.vercelTeamId,
    },
    {
      treatRoot404AsReady: previewAllowsRoot404({
        runtime: input.record.runtime as SandboxRuntime | null | undefined,
      }),
    }
  );

  let nextRecord = buildCompatibilityHealthRecord({
    record: input.record,
    sandboxStatus: input.sandbox?.status ?? input.record.status,
    devLog,
    health,
  });

  const { vercelDiagnostics, previewError } =
    await loadCompatibilityVercelDiagnostics({
      deps: input.deps,
      credentialSource: input.credentialSource,
      credentials: input.credentials,
      healthStatus: health.status,
    });

  if (previewError) {
    nextRecord = {
      ...nextRecord,
      last_preview_error: previewError,
    };
  }

  await persistCompatibilityHealthRecord(input.deps, input.record, nextRecord);

  return {
    nextRecord,
    vercelDiagnostics,
  };
}

function buildSandboxHealthResponse(
  nextRecord: SandboxHealthRecord,
  vercelDiagnostics: SandboxHealthDiagnostics | null
) {
  return NextResponse.json({
    sandbox: toSandboxClientRecord({
      ...nextRecord,
      ...(vercelDiagnostics ? { vercel_diagnostics: vercelDiagnostics } : {}),
    }),
    health: { status: nextRecord.health_status ?? "not_available" },
  });
}

export function createSandboxHealthGetHandler(
  overrides: Partial<SandboxHealthGetDeps> = {}
) {
  const hasCompatibilityOverrides = Object.keys(overrides).length > 0;
  const deps: SandboxHealthGetDeps = {
    ...defaultSandboxHealthGetDeps,
    ...overrides,
  };

  if (!hasCompatibilityOverrides) {
    return async function GET(
      request: Request,
      { params }: { params: Promise<{ id: string }> }
    ) {
      const { id } = await params;
      const loaded = await loadOwnedSandboxRouteRecord(request, id, {
        select: "id",
      });
      if (!loaded.ok) return buildSandboxRouteErrorResponse(loaded);

      let result;
      try {
        result = await reconcileSandboxReadiness(
          {
            sandboxRecordId: id,
            source: "health",
          },
          {
            includeDiagnostics: true,
          }
        );
      } catch (error) {
        const status = sandboxBillingAdmissionHttpStatus(error);
        if (!status) throw error;
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Billing failed" },
          { status }
        );
      }

      if (!result) {
        return NextResponse.json(
          { error: "Sandbox not found" },
          { status: 404 }
        );
      }

      const { health_status: status } = result.sandbox.runtime_summary;
      return NextResponse.json({
        sandbox: result.sandbox,
        health: { status },
      });
    };
  }

  return async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const sandboxData =
      await deps.loadOwnedSandboxRouteContext<SandboxHealthRecord>(
        request,
        id,
        {
          select: SANDBOX_HEALTH_ROUTE_SELECT,
        }
      );
    if (!sandboxData.ok) return buildSandboxRouteErrorResponse(sandboxData);

    let refreshed: RefreshedCompatibilityHealth;
    try {
      refreshed = await refreshCompatibilitySandboxHealth({
        deps,
        record: sandboxData.record,
        sandbox: sandboxData.sandbox,
        credentials: {
          vercelToken: sandboxData.context.credentials.vercelToken,
          vercelTeamId: sandboxData.context.credentials.vercelTeamId,
          vercelProjectId: sandboxData.context.credentials.vercelProjectId,
        },
        credentialSource: sandboxData.context.ownership.credentialSource,
      });
    } catch (error) {
      const status = sandboxBillingAdmissionHttpStatus(error);
      if (!status) throw error;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Billing failed" },
        { status }
      );
    }
    const { nextRecord, vercelDiagnostics } = refreshed;

    return buildSandboxHealthResponse(nextRecord, vercelDiagnostics);
  };
}

export const GET = createSandboxHealthGetHandler();
