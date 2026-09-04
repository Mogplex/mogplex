import { updateSandboxRecord } from "@/lib/sandbox/records";
import { clearRepoSnapshotIfCurrent } from "@/lib/repo-snapshots";
import { readSandboxPersistentFlag } from "@/lib/sandbox/persistence";
import {
  buildSandboxName,
  buildSandboxReplacementName,
} from "@/lib/sandbox/sandbox-name";
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
  const stableName =
    input.launch.sandboxNameOverride ??
    buildSandboxName({
      repoId: input.launch.repoId,
      workingBranch: input.launch.launchRequest.workingBranch,
      recordId: input.state.streamSandboxRecord.id,
      userId: input.launch.creds.userId,
      productTeamId: input.launch.productTeamId,
      rootDirectory: input.launch.effectiveRootDirectory,
    });
  // The fresh VM's name must differ from the record's current sandbox_id:
  // the repoint below is a compare-and-swap on that column, and only a
  // changed value invalidates the stale reconciler's guard. A snapshot VM is
  // provider-named so the stable name is normally free; if it is not, take
  // the deterministic replacement identity instead of reusing the name.
  return stableName === input.state.streamSandboxRecord.sandbox_id
    ? buildSandboxReplacementName(
        stableName,
        input.state.streamSandboxRecord.id
      )
    : stableName;
}

/**
 * Replace a sandbox whose baseline-snapshot restore failed with a fresh git
 * clone, keeping the DB record pointed at the VM that is actually booting.
 *
 * Order matters. The record is repointed at the fresh VM *before* the old VM
 * is stopped: the launch-time readiness reconciler was queued with the old
 * VM's name, and every write it makes is guarded on that name. Once the
 * record names the fresh VM, a late probe of the stopped old VM cannot mark
 * the record `stopped`/`vm_gone` underneath the bootstrap. That only holds
 * because the fresh VM never reuses the old VM's name (see
 * `resolveFallbackSandboxName`). Activation later guards on the fresh name,
 * which now matches. A reconciler for the fresh VM is queued at the end.
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

  let repointed: Awaited<ReturnType<typeof updateSandboxRecord>>;
  try {
    repointed = await helpers.updateSandboxRecord(
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
  } catch (error) {
    // The launch failure handler only knows about `state.sandbox`, which is
    // still the previous VM here. Stop the fresh VM ourselves so a database
    // error on the repoint does not leak it. Billing sessions are keyed by
    // record, not VM, so the handler's billing close still covers any session
    // the fresh VM opened.
    await helpers.stopSandboxInstanceBestEffort(fresh);
    throw error;
  }

  if (!repointed) {
    await helpers.stopSandboxInstanceBestEffort(fresh);
    await helpers.stopSandboxInstanceBestEffort(previous);
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

  await helpers.stopSandboxInstanceBestEffort(previous);

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
