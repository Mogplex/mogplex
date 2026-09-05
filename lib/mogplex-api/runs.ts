/**
 * External Mogplex API runs - main orchestration module.
 *
 * This module exports the public API for starting and loading external agent
 * runs. Database operations are delegated to ./runs-db.ts and request
 * normalization to ./runs-normalize.ts.
 */
import { createAiCall } from "@/lib/interactive-runs";
import { reconcileExternalAgentRunRuntime } from "./run-runtime";
import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import type { ApiKeyAuth } from "@/lib/auth/api-key";
import {
  appendExternalRunAcceptedEvent,
  findActiveSandbox,
  insertRun,
  loadOwnedRepoForRun,
  loadRunById,
  loadRunByIdempotencyKey,
  markAiCallFailedAfterRunInsertFailure,
  markExternalAgentRunFailed,
  markExternalAgentRunQueued,
  loadOwnedRunWorktree,
  type InsertExternalAgentRunInput,
  type MarkExternalAgentRunFailedInput,
  type MarkExternalAgentRunQueuedInput,
} from "./runs-db";
import {
  buildRunMetadata,
  normalizeOptionalString,
  normalizeStartRequest,
  type NormalizedStartRequest,
} from "./runs-normalize";
import { hashRequest } from "./runs-normalize";
import {
  MogplexApiRunError,
  type ExternalAgentRunRow,
  type MogplexApiRunDetail,
} from "./runs-types";

// Re-export types from runs-types.ts for backwards compatibility
export {
  MOGPLEX_API_RUN_HARNESSES,
  MOGPLEX_API_RUN_STATUSES,
  MogplexApiRunError,
  type ExternalAgentRunRow,
  type MogplexApiRunDetail,
  type MogplexApiRunHarness,
  type MogplexApiRunStatus,
  type StartMogplexApiRunRequest,
} from "./runs-types";

// Re-export for backwards compatibility
export { ACTIVE_EXTERNAL_RUN_SANDBOX_STATUSES } from "./runs-db";

type OwnedRepoForRun = {
  id: string;
  full_name: string;
  default_branch: string | null;
  root_directory: string | null;
};

type ActiveSandboxForRun = {
  id: string;
  sandbox_id: string | null;
};

type OwnedRunWorktree = Awaited<ReturnType<typeof loadOwnedRunWorktree>>;

export type StartMogplexApiRunDeps = {
  loadOwnedRepo: (
    repoId: string,
    userId: string
  ) => Promise<OwnedRepoForRun | null>;
  loadRunByIdempotencyKey: (
    userId: string,
    idempotencyKey: string
  ) => Promise<ExternalAgentRunRow | null>;
  loadRunById: (
    userId: string,
    runId: string
  ) => Promise<ExternalAgentRunRow | null>;
  findActiveSandbox: (
    input: Pick<
      NormalizedStartRequest,
      "repoId" | "workingBranch" | "rootDirectory"
    > & { userId: string }
  ) => Promise<ActiveSandboxForRun | null>;
  loadOwnedWorktree: (input: {
    userId: string;
    worktreeId: string;
  }) => Promise<OwnedRunWorktree>;
  createAiCall: typeof createAiCall;
  appendAcceptedEvent: typeof appendExternalRunAcceptedEvent;
  insertRun: (
    input: InsertExternalAgentRunInput
  ) => Promise<ExternalAgentRunRow>;
  markAiCallFailed: typeof markAiCallFailedAfterRunInsertFailure;
  queueRun: typeof queueExternalAgentRun;
  markRunQueued: (
    input: MarkExternalAgentRunQueuedInput
  ) => Promise<ExternalAgentRunRow>;
  markRunFailed: (
    input: MarkExternalAgentRunFailedInput
  ) => Promise<ExternalAgentRunRow>;
};

type ExternalAgentRunQueueResult = {
  runtimeProvider: "trigger";
  runtimeRunId: string | null;
};

const defaultStartMogplexApiRunDeps: StartMogplexApiRunDeps = {
  loadOwnedRepo: loadOwnedRepoForRun,
  loadRunByIdempotencyKey,
  loadRunById,
  findActiveSandbox,
  loadOwnedWorktree: loadOwnedRunWorktree,
  createAiCall,
  appendAcceptedEvent: appendExternalRunAcceptedEvent,
  insertRun,
  markAiCallFailed: markAiCallFailedAfterRunInsertFailure,
  queueRun: queueExternalAgentRun,
  markRunQueued: markExternalAgentRunQueued,
  markRunFailed: markExternalAgentRunFailed,
};

async function queueExternalAgentRun(input: {
  runId: string;
  userId: string;
  repoId: string;
  requestHash: string;
}): Promise<ExternalAgentRunQueueResult> {
  if (!isTriggerRuntimeConfigured()) {
    throw new Error("Trigger.dev runtime is not configured");
  }

  const { tasks } = await import("@trigger.dev/sdk/v3");
  const handle = await tasks.trigger(
    TRIGGER_TASK_IDS.externalAgentRun,
    { runId: input.runId, userId: input.userId },
    {
      idempotencyKey: `external-agent-run:${input.runId}:${input.requestHash}`,
      concurrencyKey: `external-agent-run:${input.runId}`,
      maxAttempts: 1,
      tags: [
        `user:${input.userId}`,
        `repo:${input.repoId}`,
        `external-run:${input.runId}`,
      ],
      metadata: {
        runId: input.runId,
        userId: input.userId,
        repoId: input.repoId,
      },
    }
  );

  return {
    runtimeProvider: "trigger",
    runtimeRunId: handle.id ?? null,
  };
}

export function presentMogplexApiRun(row: ExternalAgentRunRow) {
  return {
    runId: row.id,
    aiCallId: row.ai_call_id,
    sandboxRecordId: row.sandbox_record_id,
    sandboxId: row.sandbox_id,
    worktreeId: row.worktree_id,
    repoId: row.repo_id,
    harness: row.harness,
    status: row.status,
    branch: {
      base: row.base_branch,
      working: row.working_branch,
      createBranch: row.create_branch,
    },
    rootDirectory: row.root_directory,
    eventsUrl: `/api/v1/mogplex/runs/${row.id}/events`,
    cancelUrl: `/api/v1/mogplex/runs/${row.id}/cancel`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error,
    runtime: {
      provider: row.runtime_provider,
      runId: row.runtime_run_id,
    },
  } satisfies MogplexApiRunDetail;
}

export async function startMogplexApiRun(input: {
  user: Pick<ApiKeyAuth, "userId" | "keyId" | "scopes">;
  idempotencyKey: string;
  body: { repoId?: unknown; prompt?: unknown; [key: string]: unknown };
  /**
   * Extra fields to merge into the run's `metadata` JSONB — for internal
   * callers only (the public request body doesn't expose this). Core metadata
   * fields always take precedence. Used by the Slack repo-agent flow to stash
   * the "Cancel run" message coordinates so the completion hook can find it.
   */
  extraMetadata?: Record<string, unknown>;
  /** Where the run was triggered from — "slack", "api", "mcp", "cli". */
  origin?: string;
  deps?: Partial<StartMogplexApiRunDeps>;
}) {
  const deps: StartMogplexApiRunDeps = {
    ...defaultStartMogplexApiRunDeps,
    ...input.deps,
  };

  const repoId = normalizeOptionalString(input.body.repoId);
  if (!repoId) {
    throw new MogplexApiRunError("BAD_REQUEST", "repoId is required", 400);
  }

  const repo = await deps.loadOwnedRepo(repoId, input.user.userId);
  if (!repo) {
    throw new MogplexApiRunError("NOT_FOUND", "Repo not found", 404);
  }

  const normalizedResult = normalizeStartRequest({
    body: input.body,
    repo,
    idempotencyKey: input.idempotencyKey,
  });
  let { normalized, requestHash } = normalizedResult;

  const existing = await deps.loadRunByIdempotencyKey(
    input.user.userId,
    input.idempotencyKey
  );
  // A replay must remain available after its assigned worktree is archived or
  // pruned. For worktree-bound requests, compare the logical caller inputs
  // before reloading live checkout state; branch/root/sandbox were server
  // overrides on the original request.
  if (existing && normalized.worktreeId) {
    const sameLogicalRequest =
      existing.repo_id === normalized.repoId &&
      existing.prompt === normalized.prompt &&
      existing.harness === normalized.harness &&
      existing.conversation_id === normalized.conversationId &&
      existing.workspace_session_id === normalized.workspaceSessionId &&
      existing.mode === normalized.mode &&
      existing.worktree_id === normalized.worktreeId;
    if (!sameLogicalRequest) {
      throw new MogplexApiRunError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key already used for a different request",
        409
      );
    }
    return { run: presentMogplexApiRun(existing), replayed: true };
  }

  let boundWorktree: NonNullable<OwnedRunWorktree> | null = null;
  if (normalized.worktreeId) {
    boundWorktree = await deps.loadOwnedWorktree({
      userId: input.user.userId,
      worktreeId: normalized.worktreeId,
    });
    if (
      boundWorktree?.worktree.repo_id !== normalized.repoId ||
      boundWorktree?.worktree.status !== "active"
    ) {
      throw new MogplexApiRunError(
        "NOT_FOUND",
        "Active worktree not found",
        404
      );
    }
    normalized = {
      ...normalized,
      baseBranch: boundWorktree.worktree.base_branch,
      workingBranch: boundWorktree.worktree.branch_name,
      createBranch: false,
      rootDirectory: boundWorktree.worktree.checkout_path,
    };
    requestHash = hashRequest(normalized);
  }

  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new MogplexApiRunError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key already used for a different request",
        409
      );
    }
    // Replays intentionally return the original rows unchanged. Do not merge
    // `extraMetadata` here, because the idempotency contract is that the first
    // successful request owns the persisted run and ai_call metadata.
    return { run: presentMogplexApiRun(existing), replayed: true };
  }

  const sandbox =
    boundWorktree?.sandbox ??
    (await deps.findActiveSandbox({
      userId: input.user.userId,
      repoId: normalized.repoId,
      workingBranch: normalized.workingBranch,
      rootDirectory: normalized.rootDirectory,
    }));
  const metadata = buildRunMetadata({
    normalized,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    repo,
    sandbox,
    apiKey: input.user,
    origin: input.origin,
    extraMetadata: input.extraMetadata,
  });
  const aiCall = await deps.createAiCall({
    userId: input.user.userId,
    type: "agent",
    model: `harness:${normalized.harness}`,
    conversationId: normalized.conversationId,
    repoId: normalized.repoId,
    status: "pending",
    metadata,
  });
  let row: ExternalAgentRunRow;
  try {
    row = await deps.insertRun({
      userId: input.user.userId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      normalized,
      aiCallId: aiCall.id,
      sandbox,
      metadata,
    });
  } catch (error) {
    await deps.markAiCallFailed({ aiCall, error });
    const racedExisting = await deps.loadRunByIdempotencyKey(
      input.user.userId,
      input.idempotencyKey
    );
    if (racedExisting) {
      if (racedExisting.request_hash !== requestHash) {
        throw new MogplexApiRunError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key already used for a different request",
          409
        );
      }
      return { run: presentMogplexApiRun(racedExisting), replayed: true };
    }
    throw error;
  }

  await deps.appendAcceptedEvent({
    aiCall,
    run: row,
  });

  let queued: ExternalAgentRunQueueResult;
  try {
    queued = await deps.queueRun({
      runId: row.id,
      userId: row.user_id,
      repoId: row.repo_id,
      requestHash,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to queue external agent run";
    await deps.markRunFailed({
      userId: row.user_id,
      runId: row.id,
      error: message,
    });
    throw error;
  }

  const queuedRow = await deps.markRunQueued({
    userId: row.user_id,
    runId: row.id,
    runtimeProvider: queued.runtimeProvider,
    runtimeRunId: queued.runtimeRunId,
  });

  return { run: presentMogplexApiRun(queuedRow), replayed: false };
}

export async function loadMogplexApiRun(input: {
  userId: string;
  runId: string;
  deps?: Partial<Pick<StartMogplexApiRunDeps, "loadRunById">>;
  runtimeDeps?: Parameters<typeof reconcileExternalAgentRunRuntime>[1];
}) {
  const deps = {
    loadRunById,
    ...input.deps,
  };
  let run = await deps.loadRunById(input.userId, input.runId);
  if (run) {
    try {
      run = await reconcileExternalAgentRunRuntime(run, input.runtimeDeps);
    } catch (error) {
      // Provider outages are not evidence of run failure. If only Slack
      // delivery failed after persistence, still return the newly saved state.
      console.warn(
        "[mogplex-api/runs] runtime reconciliation unavailable",
        input.runId,
        error
      );
      run = await deps.loadRunById(input.userId, input.runId);
    }
  }
  return run ? presentMogplexApiRun(run) : null;
}
