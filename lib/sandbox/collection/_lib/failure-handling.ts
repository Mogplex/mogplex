import {
  SandboxBootstrapError,
  SandboxCreateRequestValidationError,
} from "@/lib/sandbox/client";
import { checkSandboxHealth } from "@/lib/sandbox/health-status";
import {
  updateSandboxRecord,
  ACTIVE_SANDBOX_STATUSES,
} from "@/lib/sandbox/records";
import {
  extractVercelApiErrorCode,
  extractVercelApiErrorDetail,
} from "@/lib/sandbox/api-error";
import { loadSandboxVercelDiagnostics } from "@/lib/vercel/load-sandbox-diagnostics";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { SANDBOX_STREAM_SELECT } from "./constants";
import { toStreamSandboxRecord } from "./response-shaping";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxRecordRow } from "@/lib/types";
import type { VercelAuthMode } from "@/lib/vercel/service";
import type { SandboxLaunchPreparation, SandboxLaunchState } from "./types";
import type { SandboxPostDeps } from "./deps";

export function classifySandboxLaunchFailure(err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown error";
  const apiCode = extractVercelApiErrorCode(err)?.toLowerCase() ?? null;
  const apiDetail = extractVercelApiErrorDetail(err);
  const detailedMessage = apiDetail ? `${message} — ${apiDetail}` : message;
  const apiDetailLower = apiDetail?.toLowerCase() ?? "";

  const sandboxRequestValidationMessage =
    apiCode === "reserved_port"
      ? `Vercel rejected the sandbox request: ${apiDetail}. Change the repo sandbox dev port or dev command to a supported port such as 3000 or 5173.`
      : apiDetailLower.includes("payload too large")
        ? `Vercel rejected the sandbox request: ${apiDetail}. Remove or shorten sandbox env vars before launching.`
        : null;

  const actionableMessage =
    err instanceof SandboxCreateRequestValidationError
      ? err.message
      : /status code (40[13]|410)/i.test(message)
        ? "Sandbox expired or unavailable. Try again."
        : /status code 400/i.test(message)
          ? sandboxRequestValidationMessage ||
            `Vercel rejected the sandbox request${apiDetail ? `: ${apiDetail}` : ""}. Check repo settings — env vars, ports, dev command, or the selected branch.`
          : detailedMessage;

  return {
    message: detailedMessage,
    actionableMessage,
    phase: err instanceof SandboxBootstrapError ? "bootstrap" : "create",
  };
}

export function shouldLoadSandboxLaunchFailureDiagnostics(
  state: SandboxLaunchState
) {
  // Before Sandbox.create succeeds, shared-project diagnostics can point at an
  // unrelated app deployment on the linked Vercel project and overwrite the
  // sandbox's own create-time error. Only attach them once a sandbox exists.
  return Boolean(state.sandbox);
}

async function resolveSandboxLaunchFailurePreviewHealth(input: {
  err: unknown;
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  actionableMessage: string;
}) {
  let healthStatus: "error" | "app_error" | "unreachable" = "error";
  let previewHttpStatus: number | null = null;
  let previewError: string | null = input.actionableMessage;

  if (
    input.state.sandbox &&
    input.err instanceof SandboxBootstrapError &&
    input.err.previewUrl
  ) {
    try {
      const health = await checkSandboxHealth(
        input.err.previewUrl,
        {
          sandboxId: input.state.sandbox.name,
          token: input.launch.createContext.credentials.vercelToken,
          projectId: input.launch.createContext.credentials.vercelProjectId,
          teamId: input.launch.createContext.credentials.vercelTeamId,
        },
        input.launch.healthCheckOptions
      );
      if (health.status === "app_error" || health.status === "unreachable") {
        healthStatus = health.status;
      }
      previewHttpStatus = health.statusCode ?? null;
      previewError = health.message || input.actionableMessage;
    } catch {
      /* keep default bootstrap failure classification */
    }
  }

  return {
    healthStatus,
    previewHttpStatus,
    previewError,
  };
}

async function loadSandboxLaunchFailureDiagnostics(
  launch: SandboxLaunchPreparation
) {
  try {
    return await loadSandboxVercelDiagnostics({
      authMode: (launch.createContext.ownership.credentialSource === "user"
        ? "personal"
        : "platform") as VercelAuthMode,
      vercelToken: launch.createContext.credentials.vercelToken,
      teamId: launch.createContext.credentials.vercelTeamId,
      projectId: launch.createContext.credentials.vercelProjectId,
    });
  } catch (diagnosticsError) {
    console.error(
      "[sandbox/create] Failed to load Vercel deployment diagnostics",
      diagnosticsError
    );
    return null;
  }
}

async function resolveSandboxLaunchFailureState(input: {
  err: unknown;
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
}) {
  const failure = classifySandboxLaunchFailure(input.err);
  const previewState = await resolveSandboxLaunchFailurePreviewHealth({
    err: input.err,
    state: input.state,
    launch: input.launch,
    actionableMessage: failure.actionableMessage,
  });
  const vercelDiagnostics = shouldLoadSandboxLaunchFailureDiagnostics(
    input.state
  )
    ? await loadSandboxLaunchFailureDiagnostics(input.launch)
    : null;
  const previewError =
    vercelDiagnostics?.buildSummary || previewState.previewError;

  return {
    failure,
    healthStatus: previewState.healthStatus,
    previewHttpStatus: previewState.previewHttpStatus,
    previewError,
    vercelDiagnostics,
  };
}

export async function handleSandboxLaunchFailure(input: {
  err: unknown;
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  emit: (event: SandboxEvent) => void;
}) {
  const failureState = await resolveSandboxLaunchFailureState(input);

  await prepareSandboxLaunchBillingCloseBestEffort({
    deps: input.deps,
    recordId: input.state.streamSandboxRecord.id,
    phase: "launch failure",
  });
  await stopSandboxInstanceBestEffort(input.state.sandbox);

  const failed = await updateSandboxRecord(
    input.state.streamSandboxRecord.id,
    {
      status: "error",
      error: failureState.failure.actionableMessage,
      health_status: failureState.healthStatus,
      last_health_check_at: new Date().toISOString(),
      last_preview_http_status: failureState.previewHttpStatus,
      last_preview_error: failureState.previewError,
      last_boot_error: failureState.failure.actionableMessage,
      last_boot_completed_at: null,
      ...(input.err instanceof SandboxBootstrapError && input.err.installLog
        ? { install_log: input.err.installLog }
        : {}),
      ...(input.err instanceof SandboxBootstrapError && input.err.devLog
        ? { dev_log: input.err.devLog }
        : {}),
    },
    {
      expectedSandboxId: input.state.sandbox?.name,
      fromStatuses: ACTIVE_SANDBOX_STATUSES,
      select: SANDBOX_STREAM_SELECT,
    }
  );

  if (failed) {
    input.state.streamSandboxRecord = failed as unknown as SandboxRecordRow;
    const failedSandboxRecord = failureState.vercelDiagnostics
      ? toSandboxClientRecord({
          ...input.state.streamSandboxRecord,
          vercel_diagnostics: failureState.vercelDiagnostics,
        })
      : toStreamSandboxRecord(input.state.streamSandboxRecord);
    input.emit({
      type: "status",
      status: "error",
      sandbox: failedSandboxRecord,
    });
  }

  input.emit({
    type: "error",
    message: failureState.failure.actionableMessage,
    phase: failureState.failure.phase,
  });
}

export async function stopSandboxInstanceBestEffort(
  sandbox: { stop: () => Promise<unknown> } | null
) {
  if (!sandbox) return;
  try {
    await sandbox.stop();
  } catch {
    /* best-effort */
  }
}

export async function prepareSandboxLaunchBillingCloseBestEffort(input: {
  deps: Pick<SandboxPostDeps, "prepareSandboxBillingClose">;
  recordId: string;
  phase: string;
}) {
  try {
    await input.deps.prepareSandboxBillingClose(input.recordId);
  } catch (error) {
    console.warn(
      `[sandbox/create] Billing close preparation failed during ${input.phase}; reconciliation will recover:`,
      error
    );
  }
}
