import { updateSandboxRecord } from "@/lib/sandbox/records";
import { clearRepoSnapshotIfCurrent } from "@/lib/repo-snapshots";
import { readSandboxPersistentFlag } from "@/lib/sandbox/persistence";
import { buildSandboxName } from "@/lib/sandbox/sandbox-name";
import { createSandboxBillingOnResume } from "@/lib/billing/sandbox-usage";
import { SANDBOX_STREAM_SELECT } from "./constants";
import { toStreamSandboxRecord } from "./response-shaping";
import { createWorkingBranchInSandbox } from "./utils";
import {
  stopSandboxInstanceBestEffort,
  prepareSandboxLaunchBillingCloseBestEffort,
} from "./failure-handling";
import { configureSandboxGitAccess } from "./provisioning";
import { queueSandboxReadinessReconciliationWarning } from "./readiness-queue";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxRecordRow } from "@/lib/types";
import type {
  SandboxLaunchState,
  SandboxLaunchPreparation,
  SandboxLaunchEnvironment,
} from "./types";
import type { SandboxPostDeps } from "./deps";

export const BASELINE_FALLBACK_CANCELLED_MESSAGE =
  "Sandbox creation was cancelled before it became ready.";

/** Record states a launch may still be in while its VM bootstraps. */
const BOOTSTRAPPING_STATUSES = ["creating", "installing"] as const;

export type BaselineFallbackInput = {
  state: SandboxLaunchState;
  launch: SandboxLaunchPreparation;
  deps: SandboxPostDeps;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
};

type BaselineFallbackHelpers = {
  updateSandboxRecord: typeof updateSandboxRecord;
  clearRepoSnapshotIfCurrent: typeof clearRepoSnapshotIfCurrent;
  stopSandboxInstanceBestEffort: typeof stopSandboxInstanceBestEffort;
  prepareSandboxLaunchBillingCloseBestEffort: typeof prepareSandboxLaunchBillingCloseBestEffort;
  configureSandboxGitAccess: typeof configureSandboxGitAccess;
  createWorkingBranchInSandbox: typeof createWorkingBranchInSandbox;
  queueSandboxReadinessReconciliationWarning: typeof queueSandboxReadinessReconciliationWarning;
};

const defaultHelpers: BaselineFallbackHelpers = {
  updateSandboxRecord,
  clearRepoSnapshotIfCurrent,
  stopSandboxInstanceBestEffort,
  prepareSandboxLaunchBillingCloseBestEffort,
  configureSandboxGitAccess,
  createWorkingBranchInSandbox,
  queueSandboxReadinessReconciliationWarning,
};

function resolveFallbackSandboxName(input: BaselineFallbackInput): string {
  // Baseline->git fallback still reuses the record's deterministic name so
  // the user sees a stable sandbox identifier across the recovery path.
  return (
    input.launch.sandboxNameOverride ??
    buildSandboxName({
      repoId: input.launch.repoId,
      workingBranch: input.launch.launchRequest.workingBranch,
      recordId: input.state.streamSandboxRecord.id,
      userId: input.launch.creds.userId,
      productTeamId: input.launch.productTeamId,
      rootDirectory: input.launch.effectiveRootDirectory,
    })
  );
}

/**
 * Replace a sandbox whose baseline-snapshot restore failed with a fresh git
 * clone, keeping the DB record pointed at the VM that is actually booting.
 *
 * Order matters. The record is repointed at the fresh VM *before* the old VM
 * is stopped: the launch-time readiness reconciler was queued with the old
 * VM's name, and every write it makes is guarded on that name. Once the
 * record names the fresh VM, a late probe of the stopped old VM cannot mark
 * the record `stopped`/`vm_gone` underneath the bootstrap. Activation later
 * guards on the fresh name, which now matches. A reconciler for the fresh VM
 * is queued at the end.
 *
 * Returns `false` when the record left the bootstrapping states in the
 * meantime (cancelled, reaped, superseded). Both VMs are stopped and the
 * caller must not continue the bootstrap.
 */
export async function fallbackFromBaselineToGit(
  input: BaselineFallbackInput,
  overrides: Partial<BaselineFallbackHelpers> = {}
): Promise<boolean> {
  const helpers: BaselineFallbackHelpers = { ...defaultHelpers, ...overrides };
  const previous = input.state.sandbox;
  const recordId = input.state.streamSandboxRecord.id;
  const previousSandboxId = input.state.streamSandboxRecord.sandbox_id;
  const targetName = resolveFallbackSandboxName(input);

  await helpers.prepareSandboxLaunchBillingCloseBestEffort({
    deps: input.deps,
    recordId,
    phase: "baseline fallback",
  });
  if (input.launch.repo.snapshot_id) {
    await helpers.clearRepoSnapshotIfCurrent(
      input.launch.repoId,
      input.launch.repo.snapshot_id
    );
  }

  // A snapshot-restored VM carries a provider-generated name, so the fresh
  // clone can take the deterministic name while the old VM is still up. Only
  // a genuine name collision forces the old VM to go first (and reopens the
  // reconciler window this ordering otherwise closes).
  const reusesName = previous?.name === targetName;
  if (reusesName) {
    await helpers.stopSandboxInstanceBestEffort(previous);
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
    name: targetName,
    onResume: createSandboxBillingOnResume(recordId),
  });

  const repointed = await helpers.updateSandboxRecord(
    recordId,
    {
      sandbox_id: fresh.name,
      persistent: readSandboxPersistentFlag(fresh) ?? false,
    },
    {
      expectedSandboxId: previousSandboxId,
      fromStatuses: BOOTSTRAPPING_STATUSES,
      select: SANDBOX_STREAM_SELECT,
    }
  );

  if (!repointed) {
    await helpers.stopSandboxInstanceBestEffort(fresh);
    if (!reusesName) {
      await helpers.stopSandboxInstanceBestEffort(previous);
    }
    input.emit({
      type: "error",
      message: BASELINE_FALLBACK_CANCELLED_MESSAGE,
      phase: "bootstrap",
    });
    return false;
  }

  input.state.sandbox = fresh;
  input.state.streamSandboxRecord = repointed as unknown as SandboxRecordRow;
  input.state.restoredFromSnapshot = false;
  input.state.restoredFromBaselineSnapshot = false;

  if (!reusesName) {
    await helpers.stopSandboxInstanceBestEffort(previous);
  }

  await input.deps.requireSandboxBillingSession(recordId, fresh);
  await helpers.configureSandboxGitAccess({
    sandbox: fresh,
    githubToken: input.launch.githubToken,
    userId: input.launch.creds.userId,
  });
  if (input.launch.launchRequest.createBranch) {
    await helpers.createWorkingBranchInSandbox(fresh, {
      ...input.launch.launchRequest,
      // Use the launch-time effective path so the branch is created in
      // the same workspace the dev server will boot at, not the repo's
      // persistent default.
      rootDirectory: input.launch.effectiveRootDirectory,
    });
  }

  input.emit({
    type: "sandbox_created",
    sandboxId: fresh.name,
    recordId,
    sandbox: toStreamSandboxRecord(input.state.streamSandboxRecord),
  });
  await helpers.queueSandboxReadinessReconciliationWarning({
    deps: input.deps,
    recordId,
    sandboxId: fresh.name,
    emit: input.emit,
  });

  return true;
}
