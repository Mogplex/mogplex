/**
 * Database operations for external agent runs.
 *
 * This module contains all Supabase interactions for the external_agent_runs
 * table and related queries. The main runs.ts module orchestrates business
 * logic and imports these data access functions.
 */
import {
  buildAiCallCompletionUpdate,
  safeAppendAiCallEvent,
  safeUpdateAiCall,
} from "@/lib/interactive-runs";
import { ACTIVE_SANDBOX_STATUSES } from "@/lib/sandbox/statuses";
import type { AiCall } from "@/lib/types";
import type { ExternalAgentRunRow, MogplexApiRunHarness } from "./runs-types";
import { loadOwnedWorktree } from "@/lib/worktrees/store";

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

type ActiveSandboxForRun = {
  id: string;
  sandbox_id: string | null;
};

export type NormalizedStartRequest = {
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
  worktreeId: string | null;
};

export type InsertExternalAgentRunInput = {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  normalized: NormalizedStartRequest;
  aiCallId: string;
  sandbox: ActiveSandboxForRun | null;
  metadata: Record<string, unknown>;
};

export type MarkExternalAgentRunQueuedInput = {
  userId: string;
  runId: string;
  runtimeProvider: "trigger";
  runtimeRunId: string | null;
};

export type MarkExternalAgentRunFailedInput = {
  userId: string;
  runId: string;
  error: string;
};

// Share the sandbox route's active lifecycle set so external runs reuse
// pending and booted sandboxes exactly like the first-party launch flow.
export const ACTIVE_EXTERNAL_RUN_SANDBOX_STATUSES = ACTIVE_SANDBOX_STATUSES;

export async function loadOwnedRepoForRun(repoId: string, userId: string) {
  const { getOwnedRepo } = await import("@/lib/repos");
  return getOwnedRepo<OwnedRepoForRun>(
    repoId,
    userId,
    "id, full_name, default_branch, root_directory"
  );
}

export async function loadRunByIdempotencyKey(
  userId: string,
  idempotencyKey: string
) {
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

export async function loadRunById(userId: string, runId: string) {
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

export async function findActiveSandbox(input: {
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

export async function insertRun(input: InsertExternalAgentRunInput) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .insert({
      user_id: input.userId,
      repo_id: input.normalized.repoId,
      ai_call_id: input.aiCallId,
      sandbox_record_id: input.sandbox?.id ?? null,
      sandbox_id: input.sandbox?.sandbox_id ?? null,
      worktree_id: input.normalized.worktreeId,
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

export async function loadOwnedRunWorktree(input: {
  userId: string;
  worktreeId: string;
}) {
  const worktree = await loadOwnedWorktree(input);
  if (!worktree) return null;
  const supabaseAdmin = await getSupabaseAdmin();
  const { data: sandbox, error } = await supabaseAdmin
    .from("sandboxes")
    .select("id, sandbox_id")
    .eq("id", worktree.sandbox_id)
    .eq("user_id", input.userId)
    .eq("repo_id", worktree.repo_id)
    .in("status", [...ACTIVE_EXTERNAL_RUN_SANDBOX_STATUSES])
    .maybeSingle();
  if (error)
    throw new Error(`Failed to load worktree sandbox: ${error.message}`);
  if (!sandbox) return null;
  return { worktree, sandbox };
}

export async function markAiCallFailedAfterRunInsertFailure(input: {
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

export async function markExternalAgentRunQueued(
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

export async function markExternalAgentRunFailed(
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

export async function appendExternalRunAcceptedEvent(input: {
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
