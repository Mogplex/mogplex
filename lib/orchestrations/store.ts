import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildIntegrationBranch, buildSpecBranch } from "./branches";
import { toRunSlug } from "./slugs";
import { assertRunTransition, assertTaskTransition } from "./state-machine";
import {
  isOrchestrationRunStatus,
  isOrchestrationTaskStatus,
  type OrchestrationApprovalMode,
  type OrchestrationEventLevel,
  type OrchestrationHarness,
  type OrchestrationRunStatus,
  type OrchestrationTaskStatus,
} from "./status";
import type {
  OrchestrationEventDTO,
  OrchestrationMergeEventDTO,
  OrchestrationRunDTO,
  OrchestrationSpecDTO,
  OrchestrationTaskDTO,
} from "./types";

/**
 * Data access for orchestration runs. Transition legality is enforced HERE
 * (assertRunTransition / assertTaskTransition — TypeScript is the single
 * source of truth for the state machines); the DB transition RPCs add the
 * compare-and-swap so concurrent writers can't clobber each other.
 */

export class OrchestrationStoreError extends Error {
  constructor(operation: string, cause: string) {
    super(`orchestration store ${operation} failed: ${cause}`);
    this.name = "OrchestrationStoreError";
  }
}

const RUNS = "orchestration_runs";
const SPECS = "orchestration_specs";
const TASKS = "orchestration_tasks";
const EVENTS = "orchestration_events";
const MERGE_EVENTS = "orchestration_merge_events";

function assertRunRow(row: Record<string, unknown>): OrchestrationRunDTO {
  if (!isOrchestrationRunStatus(row.status)) {
    throw new OrchestrationStoreError(
      "read run",
      `unknown status ${String(row.status)}`
    );
  }
  return row as unknown as OrchestrationRunDTO;
}

function assertTaskRow(row: Record<string, unknown>): OrchestrationTaskDTO {
  if (!isOrchestrationTaskStatus(row.status)) {
    throw new OrchestrationStoreError(
      "read task",
      `unknown status ${String(row.status)}`
    );
  }
  return row as unknown as OrchestrationTaskDTO;
}

export type CreateOrchestrationRunInput = {
  userId: string;
  repoId: string;
  workspaceId?: string | null;
  title: string;
  request: string;
  baseBranch: string;
  rootDirectory?: string | null;
  approvalMode?: OrchestrationApprovalMode;
};

export async function createOrchestrationRun(
  input: CreateOrchestrationRunInput
): Promise<OrchestrationRunDTO> {
  const baseSlug = toRunSlug(input.title);
  // Two missions with the same title in one repo are legitimate; the second
  // gets a short random suffix instead of an error.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug =
      attempt === 0
        ? baseSlug
        : `${baseSlug.slice(0, 55)}-${randomUUID().slice(0, 6)}`;
    const { data, error } = await supabaseAdmin
      .from(RUNS)
      .insert({
        user_id: input.userId,
        repo_id: input.repoId,
        workspace_id: input.workspaceId ?? null,
        title: input.title,
        slug,
        request: input.request,
        base_branch: input.baseBranch,
        root_directory: input.rootDirectory ?? null,
        spec_branch: buildSpecBranch(slug),
        integration_branch: buildIntegrationBranch(slug),
        approval_mode: input.approvalMode ?? "manual",
      })
      .select("*")
      .single();
    if (!error && data) return assertRunRow(data);
    const isUniqueViolation =
      error?.code === "23505" || /duplicate|unique/i.test(error?.message ?? "");
    if (!isUniqueViolation) {
      throw new OrchestrationStoreError(
        "create run",
        error?.message ?? "no row returned"
      );
    }
  }
  throw new OrchestrationStoreError(
    "create run",
    `could not find a free slug for "${baseSlug}"`
  );
}

export async function getOrchestrationRun(input: {
  runId: string;
  userId: string;
}): Promise<OrchestrationRunDTO | null> {
  const { data, error } = await supabaseAdmin
    .from(RUNS)
    .select("*")
    .eq("id", input.runId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) throw new OrchestrationStoreError("get run", error.message);
  return data ? assertRunRow(data) : null;
}

export async function listOrchestrationRuns(input: {
  userId: string;
  repoId?: string | null;
  limit?: number;
}): Promise<OrchestrationRunDTO[]> {
  let query = supabaseAdmin
    .from(RUNS)
    .select("*")
    .eq("user_id", input.userId)
    .order("updated_at", { ascending: false })
    .limit(input.limit ?? 100);
  if (input.repoId) query = query.eq("repo_id", input.repoId);
  const { data, error } = await query;
  if (error) throw new OrchestrationStoreError("list runs", error.message);
  return (data ?? []).map((row) => assertRunRow(row));
}

export async function transitionOrchestrationRun(input: {
  runId: string;
  from: OrchestrationRunStatus;
  to: OrchestrationRunStatus;
  error?: string | null;
  metadataPatch?: Record<string, unknown> | null;
}): Promise<boolean> {
  assertRunTransition(input.from, input.to);
  const { data, error } = await supabaseAdmin.rpc(
    "transition_orchestration_run",
    {
      p_run_id: input.runId,
      p_from_status: input.from,
      p_to_status: input.to,
      p_error: input.error ?? null,
      p_metadata_patch: input.metadataPatch ?? null,
    }
  );
  if (error) {
    throw new OrchestrationStoreError("transition run", error.message);
  }
  return data === true;
}

export async function transitionOrchestrationTask(input: {
  taskId: string;
  from: OrchestrationTaskStatus;
  to: OrchestrationTaskStatus;
  error?: string | null;
  metadataPatch?: Record<string, unknown> | null;
}): Promise<boolean> {
  assertTaskTransition(input.from, input.to);
  const { data, error } = await supabaseAdmin.rpc(
    "transition_orchestration_task",
    {
      p_task_id: input.taskId,
      p_from_status: input.from,
      p_to_status: input.to,
      p_error: input.error ?? null,
      p_metadata_patch: input.metadataPatch ?? null,
    }
  );
  if (error) {
    throw new OrchestrationStoreError("transition task", error.message);
  }
  return data === true;
}

export type CreateOrchestrationSpecInput = {
  runId: string;
  kind: OrchestrationSpecDTO["kind"];
  orderIndex?: number | null;
  slug: string;
  title: string;
  filePath: string;
  branchName?: string | null;
  ownedPaths?: string[];
  blockedPaths?: string[];
  dependsOn?: string[];
  acceptanceCriteria?: string[];
  validationCommands?: string[];
  prompt?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createOrchestrationSpec(
  input: CreateOrchestrationSpecInput
): Promise<OrchestrationSpecDTO> {
  const { data, error } = await supabaseAdmin
    .from(SPECS)
    .insert({
      run_id: input.runId,
      kind: input.kind,
      order_index: input.orderIndex ?? null,
      slug: input.slug,
      title: input.title,
      file_path: input.filePath,
      branch_name: input.branchName ?? null,
      owned_paths: input.ownedPaths ?? [],
      blocked_paths: input.blockedPaths ?? [],
      depends_on: input.dependsOn ?? [],
      acceptance_criteria: input.acceptanceCriteria ?? [],
      validation_commands: input.validationCommands ?? [],
      prompt: input.prompt ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new OrchestrationStoreError(
      "create spec",
      error?.message ?? "no row returned"
    );
  }
  return data as unknown as OrchestrationSpecDTO;
}

export type CreateOrchestrationTaskInput = {
  runId: string;
  specId: string;
  repoId: string;
  harness: OrchestrationHarness;
  branchName: string;
  baseBranch: string;
  agentId?: string | null;
  sandboxId?: string | null;
  rootDirectory?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createOrchestrationTask(
  input: CreateOrchestrationTaskInput
): Promise<OrchestrationTaskDTO> {
  const { data, error } = await supabaseAdmin
    .from(TASKS)
    .insert({
      run_id: input.runId,
      spec_id: input.specId,
      repo_id: input.repoId,
      harness: input.harness,
      branch_name: input.branchName,
      base_branch: input.baseBranch,
      agent_id: input.agentId ?? null,
      sandbox_id: input.sandboxId ?? null,
      root_directory: input.rootDirectory ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new OrchestrationStoreError(
      "create task",
      error?.message ?? "no row returned"
    );
  }
  return assertTaskRow(data);
}

export type AppendOrchestrationEventInput = {
  runId: string;
  type: string;
  message: string;
  level?: OrchestrationEventLevel;
  taskId?: string | null;
  repoId?: string | null;
  sandboxId?: string | null;
  branchName?: string | null;
  commitSha?: string | null;
  aiCallId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function appendOrchestrationEvent(
  input: AppendOrchestrationEventInput
): Promise<OrchestrationEventDTO> {
  const { data, error } = await supabaseAdmin
    .from(EVENTS)
    .insert({
      run_id: input.runId,
      task_id: input.taskId ?? null,
      repo_id: input.repoId ?? null,
      sandbox_id: input.sandboxId ?? null,
      type: input.type,
      level: input.level ?? "info",
      message: input.message,
      branch_name: input.branchName ?? null,
      commit_sha: input.commitSha ?? null,
      ai_call_id: input.aiCallId ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new OrchestrationStoreError(
      "append event",
      error?.message ?? "no row returned"
    );
  }
  return data as unknown as OrchestrationEventDTO;
}

export type OrchestrationRunDetails = {
  run: OrchestrationRunDTO;
  specs: OrchestrationSpecDTO[];
  tasks: OrchestrationTaskDTO[];
  events: OrchestrationEventDTO[];
  mergeEvents: OrchestrationMergeEventDTO[];
};

export async function getOrchestrationRunDetails(input: {
  runId: string;
  userId: string;
  eventLimit?: number;
}): Promise<OrchestrationRunDetails | null> {
  const run = await getOrchestrationRun(input);
  if (!run) return null;

  const [specs, tasks, events, mergeEvents] = await Promise.all([
    supabaseAdmin
      .from(SPECS)
      .select("*")
      .eq("run_id", run.id)
      .order("order_index", { ascending: true }),
    supabaseAdmin
      .from(TASKS)
      .select("*")
      .eq("run_id", run.id)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from(EVENTS)
      .select("*")
      .eq("run_id", run.id)
      .order("created_at", { ascending: false })
      .limit(input.eventLimit ?? 200),
    supabaseAdmin
      .from(MERGE_EVENTS)
      .select("*")
      .eq("run_id", run.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  for (const result of [specs, tasks, events, mergeEvents]) {
    if (result.error) {
      throw new OrchestrationStoreError("run details", result.error.message);
    }
  }
  return {
    run,
    specs: (specs.data ?? []) as unknown as OrchestrationSpecDTO[],
    tasks: ((tasks.data ?? []) as Record<string, unknown>[]).map((row) =>
      assertTaskRow(row)
    ),
    events: (events.data ?? []) as unknown as OrchestrationEventDTO[],
    mergeEvents: (mergeEvents.data ??
      []) as unknown as OrchestrationMergeEventDTO[],
  };
}
