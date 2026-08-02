import { createHash } from "node:crypto";
import {
  buildAiCallCompletionUpdate,
  createAiCall,
  safeAppendAiCallEvent,
  safeUpdateAiCall,
} from "@/lib/interactive-runs";
import { normalizeRootDirectory } from "@/lib/repo-settings";
import {
  isValidSandboxBranchName,
  isValidSandboxRootDirectory,
} from "@/lib/sandbox/launch-config";
import { ACTIVE_SANDBOX_STATUSES } from "@/lib/sandbox/statuses";
import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import type { ApiKeyAuth } from "@/lib/auth/api-key";
import type { AiCall } from "@/lib/types";

export const MOGPLEX_API_RUN_HARNESSES = ["codex", "claude-code"] as const;
export type MogplexApiRunHarness = (typeof MOGPLEX_API_RUN_HARNESSES)[number];

export const MOGPLEX_API_RUN_STATUSES = [
  "pending",
  "streaming",
  "success",
  "failed",
  "cancelled",
] as const;
export type MogplexApiRunStatus = (typeof MOGPLEX_API_RUN_STATUSES)[number];

const DEFAULT_BRANCH = "main";
const MAX_PROMPT_LENGTH = 100_000;
export const ACTIVE_EXTERNAL_RUN_SANDBOX_STATUSES = ACTIVE_SANDBOX_STATUSES;

async function getSupabaseAdmin() {
  const mod = await import("@/lib/supabase/admin");
  return mod.supabaseAdmin;
}

type OwnedRepoForRun = {
  id: string;
  full_name: string;
  default_branch: string | null;
  root_directory: string | null;
};

export type StartMogplexApiRunRequest = {
  repoId?: unknown;
  prompt?: unknown;
  harness?: unknown;
  baseBranch?: unknown;
  workingBranch?: unknown;
  createBranch?: unknown;
  rootDirectory?: unknown;
  conversationId?: unknown;
  workspaceSessionId?: unknown;
  mode?: unknown;
};

export type ExternalAgentRunRow = {
  id: string;
  user_id: string;
  repo_id: string;
  ai_call_id: string;
  sandbox_record_id: string | null;
  sandbox_id: string | null;
  idempotency_key: string;
  request_hash: string;
  harness: MogplexApiRunHarness;
  status: MogplexApiRunStatus;
  prompt: string;
  base_branch: string;
  working_branch: string;
  create_branch: boolean;
  root_directory: string | null;
  conversation_id: string | null;
  workspace_session_id: string | null;
  mode: string | null;
  runtime_provider: string | null;
  runtime_run_id: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MogplexApiRunDetail = {
  runId: string;
  aiCallId: string;
  sandboxRecordId: string | null;
  sandboxId: string | null;
  repoId: string;
  harness: MogplexApiRunHarness;
  status: MogplexApiRunStatus;
  branch: {
    base: string;
    working: string;
    createBranch: boolean;
  };
  rootDirectory: string | null;
  eventsUrl: string;
  cancelUrl: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  runtime: {
    provider: string | null;
    runId: string | null;
  };
};

type NormalizedStartRequest = {
  repoId: string;
  prompt: string;
  harness: MogplexApiRunHarness;
  baseBranch: string;
  workingBranch: string;
  createBranch: boolean;
  rootDirectory: string | null;
  conversationId: string | null;
  workspaceSessionId: string | null;
  mode: string | null;
};

type ActiveSandboxForRun = {
  id: string;
  sandbox_id: string | null;
};

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

type InsertExternalAgentRunInput = {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  normalized: NormalizedStartRequest;
  aiCallId: string;
  sandbox: ActiveSandboxForRun | null;
  metadata: Record<string, unknown>;
};

type ExternalAgentRunQueueResult = {
  runtimeProvider: "trigger";
  runtimeRunId: string | null;
};

type MarkExternalAgentRunQueuedInput = {
  userId: string;
  runId: string;
  runtimeProvider: ExternalAgentRunQueueResult["runtimeProvider"];
  runtimeRunId: string | null;
};

type MarkExternalAgentRunFailedInput = {
  userId: string;
  runId: string;
  error: string;
};

export class MogplexApiRunError extends Error {
  code: "BAD_REQUEST" | "IDEMPOTENCY_CONFLICT" | "NOT_FOUND";
  status: number;

  constructor(
    code: MogplexApiRunError["code"],
    message: string,
    status: number
  ) {
    super(message);
    this.name = "MogplexApiRunError";
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, MogplexApiRunError.prototype);
  }
}

const defaultStartMogplexApiRunDeps: StartMogplexApiRunDeps = {
  loadOwnedRepo: loadOwnedRepoForRun,
  loadRunByIdempotencyKey,
  loadRunById,
  findActiveSandbox,
  createAiCall,
  appendAcceptedEvent: appendExternalRunAcceptedEvent,
  insertRun,
  markAiCallFailed: markAiCallFailedAfterRunInsertFailure,
  queueRun: queueExternalAgentRun,
  markRunQueued: markExternalAgentRunQueued,
  markRunFailed: markExternalAgentRunFailed,
};

async function loadOwnedRepoForRun(repoId: string, userId: string) {
  const { getOwnedRepo } = await import("@/lib/repos");
  return getOwnedRepo<OwnedRepoForRun>(
    repoId,
    userId,
    "id, full_name, default_branch, root_directory"
  );
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertValidHarness(value: unknown): MogplexApiRunHarness {
  const harness = normalizeOptionalString(value) ?? "codex";
  if (MOGPLEX_API_RUN_HARNESSES.includes(harness as MogplexApiRunHarness)) {
    return harness as MogplexApiRunHarness;
  }
  throw new MogplexApiRunError("BAD_REQUEST", "Invalid harness", 400);
}

function normalizeRunRootDirectory(
  inputValue: unknown,
  repoRootDirectory: string | null
) {
  if (inputValue === undefined) return repoRootDirectory;
  if (inputValue === null) return null;
  if (typeof inputValue !== "string") {
    throw new MogplexApiRunError("BAD_REQUEST", "Invalid root directory", 400);
  }
  if (!isValidSandboxRootDirectory(inputValue)) {
    throw new MogplexApiRunError("BAD_REQUEST", "Invalid root directory", 400);
  }

  return normalizeRootDirectory(inputValue);
}

function validateBranch(name: string, label: string) {
  if (!isValidSandboxBranchName(name)) {
    throw new MogplexApiRunError("BAD_REQUEST", `Invalid ${label}`, 400);
  }
}

function buildGeneratedWorkingBranch(
  idempotencyKey: string,
  requestHash: string
) {
  const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
  return `mogplex/external/${keyHash.slice(0, 8)}-${requestHash.slice(0, 8)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function hashRequest(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function normalizeStartRequest(input: {
  body: StartMogplexApiRunRequest;
  repo: OwnedRepoForRun;
  idempotencyKey: string;
}) {
  const repoId = normalizeOptionalString(input.body.repoId);
  if (!repoId) {
    throw new MogplexApiRunError("BAD_REQUEST", "repoId is required", 400);
  }

  const prompt = normalizeOptionalString(input.body.prompt);
  if (!prompt) {
    throw new MogplexApiRunError("BAD_REQUEST", "Prompt is required", 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new MogplexApiRunError("BAD_REQUEST", "Prompt is too long", 400);
  }

  const harness = assertValidHarness(input.body.harness);
  const baseBranch =
    normalizeOptionalString(input.body.baseBranch) ??
    normalizeOptionalString(input.repo.default_branch) ??
    DEFAULT_BRANCH;
  validateBranch(baseBranch, "base branch");

  const createBranch = input.body.createBranch === true;
  const preliminary = {
    repoId,
    prompt,
    harness,
    baseBranch,
    createBranch,
    rootDirectory: normalizeRunRootDirectory(
      input.body.rootDirectory,
      input.repo.root_directory
    ),
    conversationId: normalizeOptionalString(input.body.conversationId),
    workspaceSessionId: normalizeOptionalString(input.body.workspaceSessionId),
    mode: normalizeOptionalString(input.body.mode),
  };
  // The generated branch is derived from the pre-branch logical request, then
  // included in the persisted request hash. Retrying the same request with the
  // same idempotency key deterministically produces the same branch and hash.
  const requestHash = hashRequest(preliminary);
  const workingBranch =
    normalizeOptionalString(input.body.workingBranch) ??
    (createBranch
      ? buildGeneratedWorkingBranch(input.idempotencyKey, requestHash)
      : baseBranch);
  validateBranch(workingBranch, "working branch");

  if (createBranch && workingBranch === baseBranch) {
    throw new MogplexApiRunError(
      "BAD_REQUEST",
      "Working branch must differ from base branch when createBranch is true",
      400
    );
  }

  const normalized: NormalizedStartRequest = {
    ...preliminary,
    workingBranch,
  };

  return {
    normalized,
    requestHash: hashRequest(normalized),
  };
}

function buildRunMetadata(input: {
  normalized: NormalizedStartRequest;
  idempotencyKey: string;
  requestHash: string;
  repo: OwnedRepoForRun;
  sandbox: ActiveSandboxForRun | null;
  apiKey: Pick<ApiKeyAuth, "keyId" | "scopes">;
  /** Caller-supplied extras (e.g. Slack message coords). Core fields below
   *  always win — a caller can't clobber `source`, `request_hash`, etc. */
  extraMetadata?: Record<string, unknown>;
}) {
  return {
    ...input.extraMetadata,
    source: "external-api",
    external_request_id: input.idempotencyKey,
    request_hash: input.requestHash,
    api_key_id: input.apiKey.keyId,
    api_key_scopes: input.apiKey.scopes,
    harness_id: input.normalized.harness,
    repo_id: input.normalized.repoId,
    repo: input.repo.full_name,
    base_branch: input.normalized.baseBranch,
    working_branch: input.normalized.workingBranch,
    root_directory: input.normalized.rootDirectory,
    sandbox_record_id: input.sandbox?.id ?? null,
    sandbox_id: input.sandbox?.sandbox_id ?? null,
  };
}

export function presentMogplexApiRun(row: ExternalAgentRunRow) {
  return {
    runId: row.id,
    aiCallId: row.ai_call_id,
    sandboxRecordId: row.sandbox_record_id,
    sandboxId: row.sandbox_id,
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
  body: StartMogplexApiRunRequest;
  /**
   * Extra fields to merge into the run's `metadata` JSONB — for internal
   * callers only (the public request body doesn't expose this). Core metadata
   * fields always take precedence. Used by the Slack repo-agent flow to stash
   * the "Cancel run" message coordinates so the completion hook can find it.
   */
  extraMetadata?: Record<string, unknown>;
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

  const { normalized, requestHash } = normalizeStartRequest({
    body: input.body,
    repo,
    idempotencyKey: input.idempotencyKey,
  });

  const existing = await deps.loadRunByIdempotencyKey(
    input.user.userId,
    input.idempotencyKey
  );
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

  const sandbox = await deps.findActiveSandbox({
    userId: input.user.userId,
    repoId: normalized.repoId,
    workingBranch: normalized.workingBranch,
    rootDirectory: normalized.rootDirectory,
  });
  const metadata = buildRunMetadata({
    normalized,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    repo,
    sandbox,
    apiKey: input.user,
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
}) {
  const deps = {
    loadRunById,
    ...input.deps,
  };
  const run = await deps.loadRunById(input.userId, input.runId);
  return run ? presentMogplexApiRun(run) : null;
}

async function loadRunByIdempotencyKey(userId: string, idempotencyKey: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load external agent run: ${error.message}`);
  }

  return (data as ExternalAgentRunRow | null) ?? null;
}

async function loadRunById(userId: string, runId: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load external agent run: ${error.message}`);
  }

  return (data as ExternalAgentRunRow | null) ?? null;
}

async function findActiveSandbox(input: {
  userId: string;
  repoId: string;
  workingBranch: string;
  rootDirectory: string | null;
}) {
  const supabaseAdmin = await getSupabaseAdmin();
  let query = supabaseAdmin
    .from("sandboxes")
    .select("id, sandbox_id")
    .eq("user_id", input.userId)
    .eq("repo_id", input.repoId)
    .eq("working_branch", input.workingBranch)
    // Share the sandbox route's active lifecycle set so external runs reuse
    // pending and booted sandboxes exactly like the first-party launch flow.
    .in("status", [...ACTIVE_EXTERNAL_RUN_SANDBOX_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1);

  query =
    input.rootDirectory === null
      ? query.is("root_directory", null)
      : query.eq("root_directory", input.rootDirectory);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load active sandbox: ${error.message}`);
  }

  return ((data ?? [])[0] as ActiveSandboxForRun | undefined) ?? null;
}

async function insertRun(input: InsertExternalAgentRunInput) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .insert({
      user_id: input.userId,
      repo_id: input.normalized.repoId,
      ai_call_id: input.aiCallId,
      sandbox_record_id: input.sandbox?.id ?? null,
      sandbox_id: input.sandbox?.sandbox_id ?? null,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      harness: input.normalized.harness,
      status: "pending",
      prompt: input.normalized.prompt,
      base_branch: input.normalized.baseBranch,
      working_branch: input.normalized.workingBranch,
      create_branch: input.normalized.createBranch,
      root_directory: input.normalized.rootDirectory,
      conversation_id: input.normalized.conversationId,
      workspace_session_id: input.normalized.workspaceSessionId,
      mode: input.normalized.mode,
      metadata: input.metadata,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create external agent run");
  }

  return data as ExternalAgentRunRow;
}

async function markAiCallFailedAfterRunInsertFailure(input: {
  aiCall: AiCall;
  error: unknown;
}) {
  const message =
    input.error instanceof Error
      ? input.error.message
      : "Failed to create external agent run";
  await safeUpdateAiCall(
    input.aiCall.id,
    buildAiCallCompletionUpdate({
      startedAt: input.aiCall.started_at,
      status: "failed",
      error: message,
      metadata: {
        ...input.aiCall.metadata,
        external_run_insert_failed: true,
      },
    })
  );
}

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

async function markExternalAgentRunQueued(
  input: MarkExternalAgentRunQueuedInput
) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .update({
      runtime_provider: input.runtimeProvider,
      runtime_run_id: input.runtimeRunId,
    })
    .eq("id", input.runId)
    .eq("user_id", input.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      error?.message || `Failed to mark external run ${input.runId} queued`
    );
  }

  return data as ExternalAgentRunRow;
}

async function markExternalAgentRunFailed(
  input: MarkExternalAgentRunFailedInput
) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .update({
      status: "failed",
      error: input.error,
    })
    .eq("id", input.runId)
    .eq("user_id", input.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      error?.message || `Failed to mark external run ${input.runId} failed`
    );
  }

  return data as ExternalAgentRunRow;
}

async function appendExternalRunAcceptedEvent(input: {
  aiCall: AiCall;
  run: ExternalAgentRunRow;
}) {
  await safeAppendAiCallEvent({
    aiCallId: input.aiCall.id,
    userId: input.run.user_id,
    conversationId: input.run.conversation_id,
    repoId: input.run.repo_id,
    eventType: "started",
    message: "External Mogplex run accepted",
    payload: {
      external_run_id: input.run.id,
      harness_id: input.run.harness,
      working_branch: input.run.working_branch,
    },
  });
}
