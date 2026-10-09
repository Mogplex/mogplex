/**
 * Records the terminal commit SHA when a run finishes successfully.
 * This pins artifact reads to the exact commit at run completion.
 *
 * The SHA is captured from the sandbox's HEAD (not the GitHub API) to avoid
 * race conditions where GitHub might not have the latest commit yet.
 */
import { getNeonPool } from "@/lib/db/pool";
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import type { ExternalAgentRunRow } from "./runs-types";

export type SandboxHeadResult = {
  sha: string | null;
  pushed: boolean;
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
 * Get the HEAD SHA from the sandbox and verify it's pushed to origin.
 * Uses the sandbox exec route internally to run git commands.
 */
async function getSandboxHeadViaExec(
  sandboxRecordId: string,
  userId: string,
  branch: string
): Promise<SandboxHeadResult> {
  const { createSandboxExecPostHandler } =
    await import("@/app/api/sandbox/[id]/exec/route");

  const script = `set -eu
head_sha="$(git rev-parse HEAD 2>/dev/null || echo '')"
origin_sha="$(git rev-parse "origin/${branch}" 2>/dev/null || echo '')"
echo "HEAD_SHA=$head_sha"
echo "ORIGIN_SHA=$origin_sha"`;

  const headers = new Headers(buildInternalApiHeaders(userId));
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  headers.delete("content-length");

  const response = await createSandboxExecPostHandler()(
    new Request(
      `https://internal.mogplex/api/sandbox/${sandboxRecordId}/exec`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ command: script }),
      }
    ),
    { params: Promise.resolve({ id: sandboxRecordId }) }
  );

  if (!response.ok) {
    return { sha: null, pushed: false };
  }

  const body = (await response.json().catch(() => ({}))) as {
    exitCode?: number | null;
    stdout?: string;
  };

  if (body.exitCode !== 0 || !body.stdout) {
    return { sha: null, pushed: false };
  }

  const headMatch = body.stdout.match(
    /HEAD_SHA=([a-f0-9]{40}(?:[a-f0-9]{24})?)/i
  );
  const originMatch = body.stdout.match(
    /ORIGIN_SHA=([a-f0-9]{40}(?:[a-f0-9]{24})?)/i
  );

  const headSha = headMatch?.[1] ?? null;
  const originSha = originMatch?.[1] ?? null;

  // Verify the commit is pushed: HEAD must match origin/<branch>
  const pushed = headSha !== null && headSha === originSha;

  return { sha: headSha, pushed };
}

/**
 * Atomically merge a single key into run metadata using jsonb || operator.
 * This avoids lost-update races from read-modify-write patterns.
 *
 * Uses: metadata = coalesce(metadata, '{}') || jsonb_build_object(key, value)
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
  getSandboxHead: getSandboxHeadViaExec,
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
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
