import { loadUserPlatformAccess } from "@/lib/platform-access";
import {
  pickSandboxSource,
  type SandboxSource,
} from "@/lib/sandbox/source-selection";
import { resolveConfiguredDevPort } from "@/lib/repo-settings";
import { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import { detectRuntimeFromGithub } from "@/lib/sandbox/runtimes";
import { previewAllowsRoot404 } from "@/lib/sandbox/client";
import { resolveSandboxGitAuthor } from "@/lib/sandbox/git-author";
import { clearRepoSnapshotIfCurrent } from "@/lib/repo-snapshots";
import { createSandboxBillingOnResume } from "@/lib/billing/sandbox-usage";
import { shellQuoteSingle } from "./utils";
import type { ResolvedSandboxLaunchRequest } from "@/lib/sandbox/launch-config";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type {
  SandboxLaunchPreparation,
  SandboxLaunchRuntimePreparation,
  SandboxLaunchEnvironment,
  SandboxRepoRecord,
  SandboxInstance,
} from "./types";
import type { SandboxPostDeps } from "./deps";

export async function resolveSandboxSourceForLaunch(input: {
  repo: SandboxRepoRecord;
  launchRequest: ResolvedSandboxLaunchRequest;
  githubToken: string;
  userId: string;
  productTeamId: string | null;
  effectiveRootDirectory: string | null;
}): Promise<SandboxSource> {
  let fastSpawnEnabled: boolean;
  try {
    const access = await loadUserPlatformAccess(
      input.userId,
      input.productTeamId
    );
    fastSpawnEnabled = Boolean(access.allowPlatformSandbox);
  } catch (error) {
    console.warn(
      "[sandbox/launch] platform access lookup failed; defaulting fast-spawn off",
      error
    );
    fastSpawnEnabled = false;
  }

  const snapshotLockfileHash =
    (
      input.repo as SandboxRepoRecord & {
        snapshot_lockfile_hash?: string | null;
      }
    ).snapshot_lockfile_hash ?? null;

  return pickSandboxSource({
    repo: {
      id: input.repo.id,
      full_name: input.repo.full_name,
      default_branch: input.repo.default_branch,
      root_directory: input.repo.root_directory,
      snapshot_id: input.repo.snapshot_id,
      snapshot_lockfile_hash: snapshotLockfileHash,
    },
    baseBranch: input.launchRequest.baseBranch,
    workingBranch: input.launchRequest.workingBranch,
    createBranch: input.launchRequest.createBranch,
    githubToken: input.githubToken,
    fastSpawnEnabled,
    restoreSnapshotIdRequested: input.launchRequest.restoreSnapshotId,
    // Pass the launch-time path so pickSandboxSource can refuse to
    // restore a baseline snapshot built at a different workspace.
    effectiveRootDirectory: input.effectiveRootDirectory,
  });
}

export async function resolveSandboxLaunchRuntimePreparation(input: {
  repo: SandboxRepoRecord;
  githubToken: string;
  launchRequest: ResolvedSandboxLaunchRequest;
  userId: string;
  productTeamId: string | null;
  /**
   * Pre-computed launch-time path so this helper and the surrounding
   * SandboxLaunchPreparation share a single source of truth. Avoids two
   * independent calls to resolveLaunchRootDirectory drifting if either
   * site's logic ever changes.
   */
  effectiveRootDirectory: string | null;
}): Promise<SandboxLaunchRuntimePreparation> {
  const configuredDevPort = resolveConfiguredDevPort(
    input.repo.dev_port,
    input.repo.dev_port_auto
  );
  const cloneRevision = input.launchRequest.createBranch
    ? input.launchRequest.baseBranch
    : input.launchRequest.workingBranch;
  const allowSnapshotRestore =
    !input.launchRequest.createBranch &&
    input.launchRequest.workingBranch === input.launchRequest.baseBranch;
  // Detect runtime from the workspace the sandbox will actually boot in,
  // not the repo's persistent default. Otherwise a monorepo user who
  // launches at apps/admin can have the runtime sniffed from apps/web's
  // package.json and end up with the wrong Node/Deno major version.
  const runtime: SandboxRuntime =
    input.repo.runtime ||
    (await detectRuntimeFromGithub(
      input.repo.full_name,
      input.githubToken,
      cloneRevision,
      input.effectiveRootDirectory
    ));

  const sandboxSource = await resolveSandboxSourceForLaunch({
    repo: input.repo,
    launchRequest: input.launchRequest,
    githubToken: input.githubToken,
    userId: input.userId,
    productTeamId: input.productTeamId,
    effectiveRootDirectory: input.effectiveRootDirectory,
  });

  return {
    configuredDevPort,
    cloneRevision,
    allowSnapshotRestore,
    runtime,
    healthCheckOptions: {
      treatRoot404AsReady: previewAllowsRoot404({ runtime }),
    },
    sandboxSource,
  };
}

export async function resolveSandboxLaunchEnvironment(input: {
  launch: SandboxLaunchPreparation;
  emit: (event: SandboxEvent) => void;
}): Promise<SandboxLaunchEnvironment> {
  const envResolution = await resolveRepoSandboxEnv({
    repo: input.launch.repo,
    userId: input.launch.creds.userId,
  });
  if (envResolution.sync.warning) {
    input.emit({ type: "warning", message: envResolution.sync.warning });
  }

  return {
    envResolution,
    networkPolicy:
      "ai" in input.launch.createContext
        ? input.launch.createContext.ai.networkPolicy
        : undefined,
  };
}

export function resolveEffectiveSnapshotId(launch: SandboxLaunchPreparation) {
  if (launch.launchRequest.restoreSnapshotId) {
    return launch.launchRequest.restoreSnapshotId;
  }
  if (launch.sandboxSource.kind === "snapshot") {
    return launch.sandboxSource.snapshotId;
  }
  if (launch.allowSnapshotRestore) {
    return launch.repo.snapshot_id;
  }
  return null;
}

export function isBaselineSnapshotLaunch(launch: SandboxLaunchPreparation) {
  return (
    !launch.launchRequest.restoreSnapshotId &&
    launch.sandboxSource.kind === "snapshot"
  );
}

export function resolveSnapshotCredentials(launch: SandboxLaunchPreparation) {
  if (!launch.launchRequest.restoreSnapshotProjectId) {
    return launch.createContext.credentials;
  }

  return {
    vercelToken: launch.createContext.credentials.vercelToken,
    vercelTeamId:
      launch.launchRequest.restoreSnapshotTeamId ??
      launch.createContext.credentials.vercelTeamId,
    vercelProjectId: launch.launchRequest.restoreSnapshotProjectId,
  };
}

export async function restoreSandboxFromSnapshotIfAvailable(input: {
  deps: SandboxPostDeps;
  launch: SandboxLaunchPreparation;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
  sandboxRecordId: string;
}) {
  const effectiveSnapshotId = resolveEffectiveSnapshotId(input.launch);
  if (!effectiveSnapshotId) {
    return {
      sandbox: null,
      restoredFromSnapshot: false,
      restoredFromBaselineSnapshot: false,
      shouldQueueDeferredSnapshot: input.launch.repo.snapshot_id == null,
    };
  }

  try {
    input.emit({
      type: "snapshot_restore",
      snapshotId: effectiveSnapshotId,
    });
    const snapshotCredentials = resolveSnapshotCredentials(input.launch);
    const sandbox = await input.deps.createSandboxFromSnapshot({
      vercelToken: snapshotCredentials.vercelToken,
      vercelTeamId: snapshotCredentials.vercelTeamId,
      vercelProjectId: snapshotCredentials.vercelProjectId,
      snapshotId: effectiveSnapshotId,
      runtime: input.launch.runtime,
      devPort: input.launch.configuredDevPort,
      timeoutMs: input.launch.effectiveSandboxTimeoutMs,
      envVars: input.environment.envResolution.envVars,
      networkPolicy: input.environment.networkPolicy,
      onResume: createSandboxBillingOnResume(input.sandboxRecordId),
    });
    return {
      sandbox,
      restoredFromSnapshot: true,
      restoredFromBaselineSnapshot: isBaselineSnapshotLaunch(input.launch),
      shouldQueueDeferredSnapshot: input.launch.repo.snapshot_id == null,
    };
  } catch (snapshotErr) {
    console.warn(
      "[sandbox/create] Snapshot restore failed, falling back to git:",
      snapshotErr
    );
    if (
      effectiveSnapshotId === input.launch.repo.snapshot_id &&
      input.launch.repo.snapshot_id
    ) {
      await clearRepoSnapshotIfCurrent(
        input.launch.repoId,
        input.launch.repo.snapshot_id
      );
    }
    return {
      sandbox: null,
      restoredFromSnapshot: false,
      restoredFromBaselineSnapshot: false,
      shouldQueueDeferredSnapshot: true,
    };
  }
}

export async function provisionSandboxForLaunch(input: {
  deps: SandboxPostDeps;
  launch: SandboxLaunchPreparation;
  environment: SandboxLaunchEnvironment;
  emit: (event: SandboxEvent) => void;
  sandboxName?: string;
  sandboxRecordId: string;
}) {
  const restored = await restoreSandboxFromSnapshotIfAvailable(input);
  if (restored.sandbox) {
    return restored;
  }

  const sandbox = await input.deps.createSandboxForRepo({
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
    ...(input.sandboxName ? { name: input.sandboxName } : {}),
    onResume: createSandboxBillingOnResume(input.sandboxRecordId),
  });

  return {
    sandbox,
    restoredFromSnapshot: false,
    restoredFromBaselineSnapshot: false,
    shouldQueueDeferredSnapshot: restored.shouldQueueDeferredSnapshot,
  };
}

export async function configureSandboxGitAccess(input: {
  sandbox: SandboxInstance;
  githubToken: string;
  userId: string;
}) {
  try {
    const gitAuthor = await resolveSandboxGitAuthor(input.userId);
    await input.sandbox.writeFiles([
      {
        path: ".git-credentials",
        content: Buffer.from(
          `https://x-access-token:${input.githubToken}@github.com\n`
        ),
      },
    ]);
    const credSetup = await input.sandbox.runCommand({
      cmd: "sh",
      args: [
        "-lc",
        [
          "mv .git-credentials ~/ 2>/dev/null; chmod 600 ~/.git-credentials",
          "git config --global credential.helper store",
          `git config --global user.name ${shellQuoteSingle(gitAuthor.name)}`,
          `git config --global user.email ${shellQuoteSingle(gitAuthor.email)}`,
        ].join(" && "),
      ],
    });
    if (credSetup.exitCode !== 0) {
      console.warn(
        `[sandbox/create] Git credential setup failed, exitCode=${credSetup.exitCode}`
      );
    }
  } catch (credErr) {
    console.warn("[sandbox/create] Git credential setup error:", credErr);
  }
}
