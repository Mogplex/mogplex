import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  OrchestrationWorktreeDTO,
  WorktreeSandboxContext,
  WorktreeTaskContext,
} from "./types";

const WORKTREES = "orchestration_worktrees";

export function buildReservedCheckoutPath(worktreeId: string): string {
  return `/.reserved/.worktrees/${worktreeId}`;
}

export class WorktreeStoreError extends Error {
  constructor(operation: string, cause: string) {
    super(`worktree store ${operation} failed: ${cause}`);
    this.name = "WorktreeStoreError";
  }
}

export async function loadOwnedWorktreeTask(input: {
  taskId: string;
  runId: string;
  userId: string;
}): Promise<WorktreeTaskContext | null> {
  const { data: run, error: runError } = await supabaseAdmin
    .from("orchestration_runs")
    .select("id, user_id, repo_id")
    .eq("id", input.runId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (runError) throw new WorktreeStoreError("load run", runError.message);
  if (!run) return null;

  const { data: task, error: taskError } = await supabaseAdmin
    .from("orchestration_tasks")
    .select("id, run_id, repo_id, branch_name, base_branch, agent_id")
    .eq("id", input.taskId)
    .eq("run_id", input.runId)
    .eq("repo_id", run.repo_id)
    .maybeSingle();
  if (taskError) throw new WorktreeStoreError("load task", taskError.message);
  return task ? ({ ...task, run } as WorktreeTaskContext) : null;
}

export async function loadOwnedWorktreeSandbox(input: {
  sandboxId: string;
  userId: string;
  repoId: string;
}): Promise<WorktreeSandboxContext | null> {
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select("id, repo_id, status")
    .eq("id", input.sandboxId)
    .eq("user_id", input.userId)
    .eq("repo_id", input.repoId)
    .maybeSingle();
  if (error) throw new WorktreeStoreError("load sandbox", error.message);
  return data as WorktreeSandboxContext | null;
}

export async function findLiveWorktreeForTask(input: {
  taskId: string;
  userId: string;
}): Promise<OrchestrationWorktreeDTO | null> {
  const { data, error } = await supabaseAdmin
    .from(WORKTREES)
    .select("*")
    .eq("task_id", input.taskId)
    .eq("user_id", input.userId)
    .neq("status", "pruned")
    .maybeSingle();
  if (error) throw new WorktreeStoreError("find task worktree", error.message);
  return data as OrchestrationWorktreeDTO | null;
}

export async function reserveWorktree(input: {
  userId: string;
  runId: string;
  taskId: string;
  repoId: string;
  sandboxId: string;
  agentId: string | null;
  branchName: string;
  baseBranch: string;
}): Promise<{ worktree: OrchestrationWorktreeDTO; created: boolean }> {
  const id = randomUUID();
  const { data, error } = await supabaseAdmin
    .from(WORKTREES)
    .insert({
      id,
      user_id: input.userId,
      run_id: input.runId,
      task_id: input.taskId,
      repo_id: input.repoId,
      sandbox_id: input.sandboxId,
      agent_id: input.agentId,
      branch_name: input.branchName,
      base_branch: input.baseBranch,
      checkout_path: buildReservedCheckoutPath(id),
      status: "creating",
    })
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      const winner = await findLiveWorktreeForTask({
        taskId: input.taskId,
        userId: input.userId,
      });
      if (
        winner?.run_id === input.runId &&
        winner.repo_id === input.repoId &&
        winner.sandbox_id === input.sandboxId
      ) {
        return { worktree: winner, created: false };
      }
    }
    throw new WorktreeStoreError(
      "reserve",
      error?.message ?? "no row returned"
    );
  }
  return { worktree: data as OrchestrationWorktreeDTO, created: true };
}

const STALE_WORKTREE_RESERVATION_MS = 5 * 60 * 1000;

export function staleWorktreeReservationCutoff(now = Date.now()): string {
  return new Date(now - STALE_WORKTREE_RESERVATION_MS).toISOString();
}

export function isStaleWorktreeReservation(
  updatedAt: string,
  now = Date.now()
): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  return (
    Number.isFinite(updatedAtMs) &&
    updatedAtMs < now - STALE_WORKTREE_RESERVATION_MS
  );
}

export async function reclaimStaleCreatingWorktree(input: {
  worktreeId: string;
  userId: string;
  expectedUpdatedAt: string;
}): Promise<OrchestrationWorktreeDTO | null> {
  const now = Date.now();
  const cutoff = staleWorktreeReservationCutoff(now);
  const { data, error } = await supabaseAdmin
    .from(WORKTREES)
    .update({ error: null, updated_at: new Date(now).toISOString() })
    .eq("id", input.worktreeId)
    .eq("user_id", input.userId)
    .eq("status", "creating")
    .eq("updated_at", input.expectedUpdatedAt)
    .lt("updated_at", cutoff)
    .select("*")
    .maybeSingle();
  if (error)
    throw new WorktreeStoreError("reclaim stale reservation", error.message);
  return data as OrchestrationWorktreeDTO | null;
}

export async function activateWorktree(input: {
  worktreeId: string;
  userId: string;
  checkoutPath: string;
}): Promise<OrchestrationWorktreeDTO> {
  const { data, error } = await supabaseAdmin.rpc(
    "activate_orchestration_worktree",
    {
      p_worktree_id: input.worktreeId,
      p_user_id: input.userId,
      p_checkout_path: input.checkoutPath,
    }
  );
  if (error || !data) {
    throw new WorktreeStoreError(
      "activate",
      error?.message ?? "no row returned"
    );
  }

  return data as OrchestrationWorktreeDTO;
}

export async function markWorktreeError(input: {
  worktreeId: string;
  userId: string;
  error: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from(WORKTREES)
    .update({ status: "error", error: input.error })
    .eq("id", input.worktreeId)
    .eq("user_id", input.userId)
    .in("status", ["creating", "error"]);
  if (error) throw new WorktreeStoreError("mark error", error.message);
}

export async function bindWorktreeAgent(input: {
  worktreeId: string;
  userId: string;
  agentId: string;
}): Promise<OrchestrationWorktreeDTO> {
  const { data, error } = await supabaseAdmin.rpc(
    "bind_orchestration_worktree_agent",
    {
      p_worktree_id: input.worktreeId,
      p_user_id: input.userId,
      p_agent_id: input.agentId,
    }
  );
  if (error || !data) {
    throw new WorktreeStoreError(
      "bind agent",
      error?.message ?? "active worktree not found"
    );
  }
  return data as OrchestrationWorktreeDTO;
}

export async function loadOwnedWorktree(input: {
  worktreeId: string;
  userId: string;
}): Promise<OrchestrationWorktreeDTO | null> {
  const { data, error } = await supabaseAdmin
    .from(WORKTREES)
    .select("*")
    .eq("id", input.worktreeId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) throw new WorktreeStoreError("load", error.message);
  return data as OrchestrationWorktreeDTO | null;
}

export async function listOwnedWorktrees(input: {
  userId: string;
  runId: string;
  repoId?: string | null;
  includePruned?: boolean;
}): Promise<OrchestrationWorktreeDTO[]> {
  let query = supabaseAdmin
    .from(WORKTREES)
    .select("*")
    .eq("user_id", input.userId)
    .eq("run_id", input.runId)
    .order("created_at", { ascending: true });
  if (input.repoId) query = query.eq("repo_id", input.repoId);
  if (!input.includePruned) query = query.neq("status", "pruned");
  const { data, error } = await query;
  if (error) throw new WorktreeStoreError("list", error.message);
  return (data ?? []) as OrchestrationWorktreeDTO[];
}

export async function archiveWorktreeRecord(input: {
  worktreeId: string;
  userId: string;
  expectedCreatingUpdatedAt?: string;
}): Promise<OrchestrationWorktreeDTO> {
  let query = supabaseAdmin
    .from(WORKTREES)
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", input.worktreeId)
    .eq("user_id", input.userId);
  query = input.expectedCreatingUpdatedAt
    ? query
        .eq("status", "creating")
        .eq("updated_at", input.expectedCreatingUpdatedAt)
        .lt("updated_at", staleWorktreeReservationCutoff())
    : query.in("status", ["active", "error"]);
  const { data, error } = await query.select("*").single();
  if (error || !data) {
    throw new WorktreeStoreError(
      "archive",
      error?.message ?? "archivable worktree not found"
    );
  }
  return data as OrchestrationWorktreeDTO;
}

export async function markWorktreePruned(input: {
  worktreeId: string;
  userId: string;
}): Promise<OrchestrationWorktreeDTO> {
  const { data, error } = await supabaseAdmin.rpc(
    "prune_orchestration_worktree",
    {
      p_worktree_id: input.worktreeId,
      p_user_id: input.userId,
    }
  );
  if (error || !data) {
    throw new WorktreeStoreError(
      "prune",
      error?.message ?? "archived worktree not found"
    );
  }
  return data as OrchestrationWorktreeDTO;
}
