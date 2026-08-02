import {
  fetchLockfileHashFromGithub,
  type LockfileHashResult,
} from "@/lib/sandbox/lockfile-hash";
import { normalizeRootDirectory } from "@/lib/repo-settings";

export type SandboxSourceSnapshot = {
  kind: "snapshot";
  snapshotId: string;
  expectedLockfileHash: string;
  lockfilePath: string;
};

export type SandboxSourceGitReason =
  | "no_baseline"
  | "lockfile_drift"
  | "github_hash_unavailable"
  | "feature_flag_off"
  | "manual_restore_requested"
  | "workspace_mismatch";

export type SandboxSourceGit = {
  kind: "git";
  reason: SandboxSourceGitReason;
};

export type SandboxSource = SandboxSourceSnapshot | SandboxSourceGit;

export type RepoSnapshotInfo = {
  id: string;
  full_name: string;
  default_branch: string | null;
  root_directory: string | null;
  snapshot_id: string | null;
  snapshot_lockfile_hash: string | null;
};

export type PickSandboxSourceOpts = {
  repo: RepoSnapshotInfo;
  baseBranch: string;
  workingBranch: string;
  createBranch: boolean;
  githubToken: string;
  fastSpawnEnabled: boolean;
  /** When the caller explicitly asked for a specific snapshot, skip baseline path. */
  restoreSnapshotIdRequested?: string | null;
  /**
   * The launch-time path the sandbox will actually run at, after applying
   * any per-launch override. Falls back to `repo.root_directory` when not
   * provided so existing callers stay correct.
   */
  effectiveRootDirectory?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/**
 * Decide whether to launch from the repo's baseline snapshot or do a fresh
 * git clone. The baseline snapshot only wins when:
 *   1. Fast-spawn is enabled for the requester.
 *   2. The repo has a stored baseline (`snapshot_id` + `snapshot_lockfile_hash`).
 *   3. The caller did not request a specific snapshot to restore (that's a
 *      separate manual-restore flow).
 *   4. The launch-time path matches the path the baseline was built at —
 *      otherwise we'd restore a snapshot of the wrong workspace's
 *      installed deps onto the running VM.
 *   5. The GitHub-side lockfile hash for the target ref matches the baseline.
 */
export async function pickSandboxSource(
  opts: PickSandboxSourceOpts
): Promise<SandboxSource> {
  if (!opts.fastSpawnEnabled) {
    return { kind: "git", reason: "feature_flag_off" };
  }

  if (opts.restoreSnapshotIdRequested) {
    return { kind: "git", reason: "manual_restore_requested" };
  }

  if (!opts.repo.snapshot_id || !opts.repo.snapshot_lockfile_hash) {
    return { kind: "git", reason: "no_baseline" };
  }

  // Workspace mismatch: the baseline was built at `repo.root_directory`,
  // so its installed-deps state is meaningless for a launch at a
  // different workspace. Fall through to a fresh clone so install runs
  // against the right package.json. When no override is supplied we
  // fall back to repo.root_directory and the comparison is a no-op.
  const baselinePath = normalizeRootDirectory(opts.repo.root_directory);
  const launchPath =
    opts.effectiveRootDirectory === undefined
      ? baselinePath
      : normalizeRootDirectory(opts.effectiveRootDirectory);
  if (launchPath !== baselinePath) {
    return { kind: "git", reason: "workspace_mismatch" };
  }

  const ref = opts.createBranch ? opts.baseBranch : opts.workingBranch;

  let githubHash: LockfileHashResult | null;
  try {
    githubHash = await fetchLockfileHashFromGithub({
      repoFullName: opts.repo.full_name,
      ref,
      token: opts.githubToken,
      // Use the launch-time path so the lockfile lookup follows the
      // workspace the sandbox will actually run in. Equal to
      // repo.root_directory at this point because the workspace
      // mismatch above already returned, but naming the right
      // variable here is self-documenting and safe against future
      // divergence (e.g. if the mismatch guard ever loosens).
      rootDir: launchPath,
      fetchImpl: opts.fetchImpl,
      now: opts.now,
    });
  } catch {
    return { kind: "git", reason: "github_hash_unavailable" };
  }

  if (!githubHash) {
    return { kind: "git", reason: "github_hash_unavailable" };
  }

  if (githubHash.hash !== opts.repo.snapshot_lockfile_hash) {
    return { kind: "git", reason: "lockfile_drift" };
  }

  return {
    kind: "snapshot",
    snapshotId: opts.repo.snapshot_id,
    expectedLockfileHash: opts.repo.snapshot_lockfile_hash,
    lockfilePath: githubHash.lockfilePath,
  };
}
