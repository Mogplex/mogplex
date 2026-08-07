import {
  BaselineSnapshotRestoreError,
  bootstrapFromBaselineSnapshotStreaming,
  bootstrapFromSnapshotStreaming,
  bootstrapSandboxStreaming,
  persistentSandboxesDisabledByEnv,
} from "@/lib/sandbox/client";
import { checkSandboxHealth } from "@/lib/sandbox/health-status";
import { updateSandboxRecord } from "@/lib/sandbox/records";
import { getRepoLinkedVercelProject } from "@/lib/vercel/env-vars";
import { clearRepoSnapshotIfCurrent } from "@/lib/repo-snapshots";
import { readSandboxPersistentFlag } from "@/lib/sandbox/persistence";
import { buildSandboxName } from "@/lib/sandbox/sandbox-name";
import { createSandboxBillingOnResume } from "@/lib/billing/sandbox-usage";
import { SANDBOX_STREAM_SELECT } from "./constants";
import {
  toStreamSandboxRecord,
  toStreamStatusSandboxRecord,
} from "./response-shaping";
import { createWorkingBranchInSandbox } from "./utils";
import {
  shouldQueueSnapshotWarmupOnSandboxLaunch,
  summarizeDeferredSnapshotWarmupQueueResult,
} from "./snapshot-warmup";
import {
  stopSandboxInstanceBestEffort,
  prepareSandboxLaunchBillingCloseBestEffort,
} from "./failure-handling";
import { configureSandboxGitAccess } from "./provisioning";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxRecord, SandboxRecordRow } from "@/lib/types";
import type {
  SandboxLaunchPreparation,
  SandboxLaunchState,
  SandboxLaunchEnvironment,
  SandboxRepoRecord,
  SandboxInstance,
} from "./types";
import type { SandboxPostDeps } from "./deps";

export function buildSandboxInstallingRecordUpdates(input: {
  sandboxId: string;
  sandbox: unknown;
}) {
  return {
    sandbox_id: input.sandboxId,
    status: "installing",
    persistent: readSandboxPersistentFlag(input.sandbox) ?? false,
  };
}

export function resolvePendingSandboxPersistenceFlag() {
  return !persistentSandboxesDisabledByEnv();
}

export async function transitionSandboxRecordToInstalling(input: {
  recordId: string;
  sandboxId: string;
  sandbox: SandboxInstance | null;
}) {
  const installing = await updateSandboxRecord(
    input.recordId,
    buildSandboxInstallingRecordUpdates(input),
    {
      fromStatuses: "creating",
      select: SANDBOX_STREAM_SELECT,
    }
  );

  return installing as SandboxRecordRow | null;
}

export function createInitialSandboxLaunchState(
  record: SandboxRecordRow,
  repo: SandboxRepoRecord
): SandboxLaunchState {
  return {
    sandbox: null,
    previewUrl: null,
    restoredFromSnapshot: false,
    restoredFromBaselineSnapshot: false,
    shouldQueueDeferredSnapshot: repo.snapshot_id == null,
    streamSandboxRecord: record,
  };
}

export function emitStreamSandboxStatus(
  emit: (event: SandboxEvent) => void,
  status: Extract<SandboxEvent, { type: "status" }>["status"],
  record: SandboxRecordRow | SandboxRecord
) {
  emit({
    type: "status",
    status,
    sandbox: toStreamStatusSandboxRecord(record),
  });
}

export async function queueSandboxReadinessReconciliationWarning(input: {
  deps: SandboxPostDeps;
  recordId: string;
  sandboxId: string;
  emit: (event: SandboxEvent) => void;
}) {
  try {
    const readinessRun = await input.deps.startSandboxReadinessReconciliation({
      sandboxRecordId: input.recordId,
      expectedSandboxId: input.sandboxId,
      source: "launch",
    });
    if (
      !readinessRun.queued &&
      readinessRun.reason !== "trigger_not_configured"
    ) {
      input.emit({
        type: "warning",
        message: "Sandbox readiness reconciliation could not be queued.",
      });
    }
  } catch (error) {
    console.error(
      "[sandbox/create] Failed to queue sandbox readiness reconciliation",
      error
    );
    input.emit({
      type: "warning",
      message: "Sandbox readiness reconciliation could not be queued.",
    });
  }
}

function createSandboxBootstrapStream(input: {
  state: SandboxLaunchState;
  sandbox: SandboxInstance;
  launch: SandboxLaunchPreparation;
  environment: SandboxLaunchEnvironment;
}) {
  if (
    input.state.restoredFromBaselineSnapshot &&
    input.launch.sandboxSource.kind === "snapshot"
  ) {
    return bootstrapFromBaselineSnapshotStreaming(input.sandbox, {
      rootDirectory: input.launch.effectiveRootDirectory,
      installCommand: input.launch.repo.install_command,
      devCommand: input.launch.repo.dev_command,
      devPort: input.launch.configuredDevPort,
      envVars: input.environment.envResolution.envVars,
      envSyncMode: input.environment.envResolution.sync.mode,
      linkedVercelProject: getRepoLinkedVercelProject(input.launch.repo),
      runtime: input.launch.runtime,
      baseBranch: input.launch.launchRequest.baseBranch,
      workingBranch: input.launch.launchRequest.workingBranch,
      createBranch: input.launch.launchRequest.createBranch,
      expectedLockfileHash: input.launch.sandboxSource.expectedLockfileHash,
    });
  }

  if (input.state.restoredFromSnapshot) {
    return bootstrapFromSnapshotStreaming(input.sandbox, {
      rootDirectory: input.launch.effectiveRootDirectory,
      devCommand: input.launch.repo.dev_command,
      devPort: input.launch.configuredDevPort,
      envVars: input.environment.envResolution.envVars,
      envSyncMode: input.environment.envResolution.sync.mode,
      linkedVercelProject: getRepoLinkedVercelProject(input.launch.repo),
      runtime: input.launch.runtime,
    });
  }

  return bootstrapSandboxStreaming(input.sandbox, {
    rootDirectory: input.launch.effectiveRootDirectory,
    installCommand: input.launch.repo.install_command,
    devCommand: input.launch.repo.dev_command,
    devPort: input.launch.configuredDevPort,
    envVars: input.environment.envResolution.envVars,
    envSyncMode: input.environment.envResolution.sync.mode,
    linkedVercelProject: getRepoLinkedVercelProject(input.launch.repo),
    runtime: input.launch.runtime,
  });
}

async function maybeQueueDeferredSnapshotWarmup(input: {
  deps: SandboxPostDeps;
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  emit: (event: SandboxEvent) => void;
}) {
  if (
    !input.state.shouldQueueDeferredSnapshot ||
    !shouldQueueSnapshotWarmupOnSandboxLaunch()
  ) {
    return;
  }

  try {
    const snapshotWarmupRun = await input.deps.startDeferredRepoSnapshotBuild({
      repoId: input.launch.repo.id,
    });
    const snapshotWarmupSummary =
      summarizeDeferredSnapshotWarmupQueueResult(snapshotWarmupRun);
    const snapshotWarmupLogContext = {
      repoId: input.launch.repo.id,
      ...snapshotWarmupSummary.details,
    };

    if (snapshotWarmupSummary.logLevel === "warn") {
      console.warn(snapshotWarmupSummary.logMessage, snapshotWarmupLogContext);
    } else {
      console.info(snapshotWarmupSummary.logMessage, snapshotWarmupLogContext);
    }

    if (snapshotWarmupSummary.warningMessage) {
      input.emit({
        type: "warning",
        message: snapshotWarmupSummary.warningMessage,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown snapshot queue error";
    console.warn("[sandbox/create] Failed to queue deferred snapshot build", {
      repoId: input.launch.repo.id,
      error: message,
    });
    input.emit({
      type: "warning",
      message: "Automatic snapshot warmup could not be queued.",
    });
  }
}

async function activateRunningSandboxRecord(input: {
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  emit: (event: SandboxEvent) => void;
}) {
  const timestamp = new Date().toISOString();
  const previewHealth = input.state.previewUrl
    ? await checkSandboxHealth(
        input.state.previewUrl,
        {
          sandboxId: input.state.sandbox!.name,
          token: input.launch.createContext.credentials.vercelToken,
          projectId: input.launch.createContext.credentials.vercelProjectId,
          teamId: input.launch.createContext.credentials.vercelTeamId,
        },
        input.launch.healthCheckOptions
      )
    : {
        status: "not_available" as const,
        message: "No preview URL",
        statusCode: undefined,
      };
  const sandboxStatus =
    previewHealth.status === "stopped" ? "stopped" : "running";

  const activated = await updateSandboxRecord(
    input.state.streamSandboxRecord.id,
    {
      status: sandboxStatus,
      preview_url: input.state.previewUrl,
      health_status: previewHealth.status,
      last_health_check_at: timestamp,
      last_active_at: timestamp,
      last_preview_http_status: previewHealth.statusCode ?? null,
      last_preview_error:
        previewHealth.status === "running" ||
        previewHealth.status === "idle_warning"
          ? null
          : previewHealth.message,
      last_boot_completed_at: timestamp,
      last_boot_error: null,
      error: null,
    },
    {
      expectedSandboxId: input.state.sandbox!.name,
      fromStatuses: ["creating", "installing", "running"],
      select: SANDBOX_STREAM_SELECT,
    }
  );

  if (!activated) {
    await prepareSandboxLaunchBillingCloseBestEffort({
      deps: input.deps,
      recordId: input.state.streamSandboxRecord.id,
      phase: "activation conflict",
    });
    await stopSandboxInstanceBestEffort(input.state.sandbox);
    input.emit({
      type: "error",
      message: "Sandbox creation was cancelled before it became ready.",
      phase: "bootstrap",
    });
    return false;
  }

  input.state.streamSandboxRecord = activated as unknown as SandboxRecordRow;
  const readySandbox = toStreamSandboxRecord(input.state.streamSandboxRecord);
  const { status: readyStatus } = readySandbox.runtime_summary;
  emitStreamSandboxStatus(
    input.emit,
    readyStatus as Extract<SandboxEvent, { type: "status" }>["status"],
    readySandbox
  );
  input.emit({ type: "ready", sandbox: readySandbox });

  if (sandboxStatus === "running") {
    await maybeQueueDeferredSnapshotWarmup(input);
  }

  return true;
}

async function consumeSandboxBootstrapStreamOnce(input: {
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
}) {
  const bootstrapStream = createSandboxBootstrapStream({
    state: input.state,
    sandbox: input.state.sandbox!,
    launch: input.launch,
    environment: input.environment,
  });

  for await (const event of bootstrapStream) {
    if (event.type === "warning" || event.type === "log") {
      input.emit(event);
      continue;
    }

    if (event.type === "preview_url") {
      input.state.previewUrl = event.url;
      input.state.streamSandboxRecord = {
        ...input.state.streamSandboxRecord,
        preview_url: event.url,
      };
      input.emit({
        type: "preview_url",
        url: event.url,
        sandbox: toStreamSandboxRecord(input.state.streamSandboxRecord),
      });
      continue;
    }

    if (event.type === "status" && event.status === "installing") {
      input.state.streamSandboxRecord = {
        ...input.state.streamSandboxRecord,
        status: "installing",
      };
      emitStreamSandboxStatus(
        input.emit,
        "installing",
        input.state.streamSandboxRecord
      );
      continue;
    }

    if (event.type === "status" && event.status === "running") {
      const activated = await activateRunningSandboxRecord(input);
      if (!activated) {
        return;
      }
    }
  }
}

async function fallbackFromBaselineToGit(input: {
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
}) {
  await prepareSandboxLaunchBillingCloseBestEffort({
    deps: input.deps,
    recordId: input.state.streamSandboxRecord.id,
    phase: "baseline fallback",
  });
  await stopSandboxInstanceBestEffort(input.state.sandbox);
  if (input.launch.repo.snapshot_id) {
    await clearRepoSnapshotIfCurrent(
      input.launch.repoId,
      input.launch.repo.snapshot_id
    );
  }
  const fresh = await input.deps.createSandboxForRepo({
    vercelToken: input.launch.createContext.credentials.vercelToken,
    vercelTeamId: input.launch.createContext.credentials.vercelTeamId,
    vercelProjectId: input.launch.createContext.credentials.vercelProjectId,
    githubToken: input.launch.githubToken,
    repoFullName: input.launch.repo.full_name,
    branch: input.launch.cloneRevision,
    runtime: input.launch.runtime,
    devPort: input.launch.configuredDevPort,
    timeoutMs: input.launch.effectiveSandboxTimeoutMs,
    envVars: input.environment.envResolution.envVars,
    networkPolicy: input.environment.networkPolicy,
    // Baseline->git fallback still reuses the record's name so the user
    // sees a stable sandbox identifier across the recovery path.
    name: buildSandboxName({
      repoId: input.launch.repoId,
      workingBranch: input.launch.launchRequest.workingBranch,
      recordId: input.state.streamSandboxRecord.id,
      userId: input.launch.creds.userId,
      productTeamId: input.launch.productTeamId,
      rootDirectory: input.launch.effectiveRootDirectory,
    }),
    onResume: createSandboxBillingOnResume(input.state.streamSandboxRecord.id),
  });
  input.state.sandbox = fresh;
  input.state.restoredFromSnapshot = false;
  input.state.restoredFromBaselineSnapshot = false;
  await input.deps.requireSandboxBillingSession(
    input.state.streamSandboxRecord.id,
    fresh
  );
  await configureSandboxGitAccess({
    sandbox: fresh,
    githubToken: input.launch.githubToken,
    userId: input.launch.creds.userId,
  });
  if (input.launch.launchRequest.createBranch) {
    await createWorkingBranchInSandbox(fresh, {
      ...input.launch.launchRequest,
      // Use the launch-time effective path so the branch is created in
      // the same workspace the dev server will boot at, not the repo's
      // persistent default.
      rootDirectory: input.launch.effectiveRootDirectory,
    });
  }
}

export async function consumeSandboxBootstrapStream(input: {
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
}) {
  try {
    await consumeSandboxBootstrapStreamOnce(input);
  } catch (err) {
    if (
      err instanceof BaselineSnapshotRestoreError &&
      input.state.restoredFromBaselineSnapshot
    ) {
      console.warn(
        `[sandbox/launch] Baseline restore failed (phase=${err.phase}): ${err.message}. Falling back to git clone.`
      );
      input.emit({
        type: "warning",
        message:
          "Baseline snapshot could not be applied cleanly; retrying with a fresh git clone.",
      });
      await fallbackFromBaselineToGit(input);
      await consumeSandboxBootstrapStreamOnce(input);
      return;
    }
    throw err;
  }
}
