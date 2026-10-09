/**
 * Records the terminal commit SHA when a run finishes successfully.
 * This pins artifact reads to the exact commit at run completion.
 *
 * The SHA is read from the run branch inside the sandbox (not the GitHub API) to avoid
 * race conditions where GitHub might not have the latest commit yet.
 */
import type { Sandbox } from "@vercel/sandbox";
import { getNeonPool } from "@/lib/db/pool";
import { resolveVmCredentials } from "@/lib/sandbox/auto-pause-deps";
import { SANDBOX_WORKSPACE_ROOT } from "@/lib/sandbox/working-directory";
import { COMMIT_SHA_PATTERN, type ExternalAgentRunRow } from "./runs-types";

export type SandboxHeadResult = {
  sha: string | null;
  pushed: boolean;
};

/**
 * Sandbox record shape for terminal commit recording. Matches fields required
 * by `resolveVmCredentials` (SandboxAutoPauseRecord) for consistent credential
 * resolution between platform-billed and user-billed sandboxes.
 */
type SandboxRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  status: string;
  health_status: string | null;
  exec_lock_token: string | null;
  persistent: boolean | null;
  billing_source: string | null;
  billing_team_id: string | null;
  billing_project_id: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RecordTerminalCommitDeps = {
  getSandboxHead: (
    sandboxRecordId: string,
    userId: string,
    branch: string
  ) => Promise<SandboxHeadResult>;
  updateRunMetadata: (
    userId: string,
    runId: string,
    metadataKey: string,
    metadataValue: string
  ) => Promise<void>;
};

/**
 * Run a shell command in the sandbox's repository checkout.
 * Thin wrapper around sandbox.runCommand for testability. The provider
 * resolves a missing or relative cwd against `/`, so the workspace root is
 * always passed explicitly.
 */
async function runSandboxShell(
  sandbox: Sandbox,
  command: string,
  env: Record<string, string>
): Promise<CommandResult> {
  const process = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", command],
    cwd: SANDBOX_WORKSPACE_ROOT,
    env,
  });
  const [stdout, stderr, result] = await Promise.all([
    process.stdout(),
    process.stderr(),
    process.wait(),
  ]);
  return { exitCode: result.exitCode, stdout, stderr };
}

/**
 * Load sandbox record from the database with all fields needed for
 * credential resolution via resolveVmCredentials.
 */
async function loadSandboxRecord(
  sandboxRecordId: string
): Promise<SandboxRecord | null> {
  const pool = getNeonPool();
  const result = await pool.query<SandboxRecord>(
    `SELECT id, user_id, repo_id, sandbox_id, status, health_status,
            exec_lock_token, persistent, billing_source, billing_team_id,
            billing_project_id, vercel_team_id, vercel_project_id
     FROM sandboxes WHERE id = $1`,
    [sandboxRecordId]
  );
  return result.rows[0] ?? null;
}

/**
 * Get a sandbox handle without resuming it.
 * Returns null if the sandbox doesn't exist or isn't running.
 * Uses resolveVmCredentials for consistent credential resolution between
 * platform-billed and user-billed sandboxes (same seam as cleanupTerminalRunSandbox).
 */
async function getSandboxHandle(
  record: SandboxRecord,
  userId: string
): Promise<Sandbox | null> {
  // Defense-in-depth: validate ownership like cleanupTerminalRunSandbox does
  if (record.user_id !== userId) {
    console.warn("[terminal-commit] sandbox record user mismatch", {
      sandboxRecordId: record.id,
      recordUserId: record.user_id,
      runUserId: userId,
    });
    return null;
  }

  const { getSandboxIfExists } = await import("@/lib/sandbox/sdk-adapter");

  // Use resolveVmCredentials for consistent handling of platform vs user billing
  const credentials = await resolveVmCredentials(record);
  if (!credentials) {
    console.warn("[terminal-commit] could not resolve VM credentials", {
      sandboxRecordId: record.id,
      billingSource: record.billing_source,
    });
    return null;
  }

  try {
    return await getSandboxIfExists(record.sandbox_id, credentials);
  } catch {
    // Sandbox not available - skip pinning
    return null;
  }
}

export type SandboxCommandDeps = {
  loadSandboxRecord: typeof loadSandboxRecord;
  getSandboxHandle: (
    record: SandboxRecord,
    userId: string
  ) => Promise<Sandbox | null>;
  runSandboxShell: typeof runSandboxShell;
};

const defaultSandboxCommandDeps: SandboxCommandDeps = {
  loadSandboxRecord,
  getSandboxHandle,
  runSandboxShell,
};

/**
 * Reads the run's branch tip and its remote-tracking ref. Branch refs are
 * shared by every worktree of the checkout, so this finds the run's commit
 * whether it worked at the workspace root or in `.worktrees/<run>`; the
 * root's own HEAD may belong to a different run. The branch name arrives
 * through the environment rather than being spliced into the script.
 */
export const TERMINAL_COMMIT_SCRIPT = `set -eu
head_sha="$(git rev-parse --verify --quiet "refs/heads/$MOGPLEX_WORKING_BRANCH^{commit}" || true)"
origin_sha="$(git rev-parse --verify --quiet "refs/remotes/origin/$MOGPLEX_WORKING_BRANCH^{commit}" || true)"
echo "HEAD_SHA=$head_sha"
echo "ORIGIN_SHA=$origin_sha"`;

/**
 * Get the run branch's commit from the sandbox using lib-level sandbox commands.
 * Skips pinning if the sandbox isn't running (doesn't resume it).
 */
async function getSandboxHeadViaSdk(
  sandboxRecordId: string,
  userId: string,
  branch: string,
  deps: SandboxCommandDeps = defaultSandboxCommandDeps
): Promise<SandboxHeadResult> {
  // Load sandbox record to get the sandbox_id and check status
  const record = await deps.loadSandboxRecord(sandboxRecordId);
  if (!record) {
    console.warn("[terminal-commit] sandbox record not found", {
      sandboxRecordId,
    });
    return { sha: null, pushed: false };
  }

  // Skip if sandbox is not in a running state
  if (record.status !== "running") {
    console.warn("[terminal-commit] sandbox not running, skipping", {
      sandboxRecordId,
      status: record.status,
    });
    return { sha: null, pushed: false };
  }

  // Get sandbox handle without resuming
  const sandbox = await deps.getSandboxHandle(record, userId);
  if (!sandbox) {
    console.warn("[terminal-commit] could not get sandbox handle", {
      sandboxRecordId,
      sandboxId: record.sandbox_id,
    });
    return { sha: null, pushed: false };
  }

  try {
    const result = await deps.runSandboxShell(sandbox, TERMINAL_COMMIT_SCRIPT, {
      MOGPLEX_WORKING_BRANCH: branch,
    });
    if (result.exitCode !== 0) {
      console.warn("[terminal-commit] git command failed", {
        sandboxRecordId,
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 200),
      });
      return { sha: null, pushed: false };
    }
    return parseGitHeadOutput(result.stdout);
  } catch (error) {
    console.warn("[terminal-commit] sandbox command failed", {
      sandboxRecordId,
      errorClass: error instanceof Error ? error.constructor.name : "unknown",
      errorMessage: error instanceof Error ? error.message : "unknown",
    });
    return { sha: null, pushed: false };
  }
}

/**
 * Parse git HEAD and origin SHA from the output of a git rev-parse script.
 * Exported for testability.
 */
export function parseGitHeadOutput(stdout: string): SandboxHeadResult {
  // Extract and validate SHAs against the shared pattern
  const headMatch = stdout.match(/HEAD_SHA=(\S+)/i);
  const originMatch = stdout.match(/ORIGIN_SHA=(\S+)/i);

  const headCandidate = headMatch?.[1]?.toLowerCase() ?? null;
  const originCandidate = originMatch?.[1]?.toLowerCase() ?? null;

  // Validate against the shared pattern (40 or 64 hex chars)
  const headSha =
    headCandidate && COMMIT_SHA_PATTERN.test(headCandidate)
      ? headCandidate
      : null;
  const originSha =
    originCandidate && COMMIT_SHA_PATTERN.test(originCandidate)
      ? originCandidate
      : null;

  // Verify the commit is pushed: HEAD must match origin/<branch>
  const pushed = headSha !== null && headSha === originSha;

  return { sha: headSha, pushed };
}

/**
 * Atomically merge a single key into run metadata using jsonb || operator.
 * This avoids lost-update races from read-modify-write patterns.
 *
 * Uses: metadata = coalesce(metadata, '{}') || jsonb_build_object(key, value)
 *
 * Rationale: supabase-js read-modify-write would clobber concurrent metadata
 * keys if another writer updated between our read and write. The raw SQL merge
 * is atomic at the row level.
 */
async function updateRunMetadataAtomic(
  userId: string,
  runId: string,
  metadataKey: string,
  metadataValue: string
): Promise<void> {
  const pool = getNeonPool();
  // Atomic jsonb merge - no read-modify-write race
  const result = await pool.query(
    `UPDATE external_agent_runs
     SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object($1::text, $2::text),
         updated_at = now()
     WHERE id = $3 AND user_id = $4`,
    [metadataKey, metadataValue, runId, userId]
  );

  if (result.rowCount === 0) {
    console.warn("[terminal-commit] atomic metadata update matched no rows", {
      runId,
      userId,
    });
  }
}

const defaultDeps: RecordTerminalCommitDeps = {
  getSandboxHead: getSandboxHeadViaSdk,
  updateRunMetadata: updateRunMetadataAtomic,
};

/**
 * Record the terminal commit SHA for a successfully completed run.
 * This is best-effort and never throws. A failure to record does not affect
 * run status - artifact reads will fall back to the branch tip.
 *
 * The SHA is captured from the sandbox's HEAD, not the GitHub API, to avoid
 * race conditions. We only record if the commit is verified as pushed.
 */
export async function recordTerminalCommitSha(
  run: ExternalAgentRunRow,
  overrides: Partial<RecordTerminalCommitDeps> = {}
): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };

  // Need sandbox_record_id to query the sandbox
  if (!run.sandbox_record_id) {
    console.warn("[terminal-commit] no sandbox_record_id, skipping", {
      runId: run.id,
    });
    return;
  }

  try {
    const { sha, pushed } = await deps.getSandboxHead(
      run.sandbox_record_id,
      run.user_id,
      run.working_branch
    );

    if (!sha) {
      console.warn("[terminal-commit] could not get HEAD SHA from sandbox", {
        runId: run.id,
      });
      return;
    }

    if (!pushed) {
      console.warn("[terminal-commit] HEAD not pushed to origin, skipping", {
        runId: run.id,
        sha,
      });
      return;
    }

    await deps.updateRunMetadata(
      run.user_id,
      run.id,
      "terminal_commit_sha",
      sha
    );
  } catch (error) {
    console.warn("[terminal-commit] failed to record terminal commit", {
      runId: run.id,
      errorClass: error instanceof Error ? error.constructor.name : "unknown",
      errorMessage: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Default timeout for terminal commit recording: 10 seconds. */
export const TERMINAL_COMMIT_TIMEOUT_MS = 10_000;

/**
 * Record terminal commit with a timeout guard. Best-effort: catches and logs
 * failures without throwing. Used by both the worker's `finalizeHarnessPass`
 * and the supervisor's `finalizeRunAfterWorkerExit` so the timeout policy
 * and cleanup live in one place.
 */
export async function recordTerminalCommitWithTimeout(
  run: ExternalAgentRunRow,
  timeoutMs: number = TERMINAL_COMMIT_TIMEOUT_MS,
  overrides: Partial<RecordTerminalCommitDeps> = {}
): Promise<void> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      recordTerminalCommitSha(run, overrides),
      new Promise<void>((_, reject) => {
        timerId = setTimeout(
          () => reject(new Error("Terminal commit recording timed out")),
          timeoutMs
        );
      }),
    ]);
  } catch (error) {
    console.warn("[terminal-commit] recording failed or timed out", {
      runId: run.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}

// Export for testing
export { getSandboxHeadViaSdk, defaultSandboxCommandDeps };
export type { SandboxRecord, CommandResult };
