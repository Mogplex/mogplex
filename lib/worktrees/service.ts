import {
  buildCreateWorktreeCommand,
  buildPruneWorktreeCommand,
  buildRebaseWorktreeCommand,
  buildWorktreeDiffCommand,
  parseCreatedWorktreePath,
} from "./commands";
import { executeWorktreeCommand, WorktreeExecutorError } from "./executor";
import {
  activateWorktree,
  archiveWorktreeRecord,
  findLiveWorktreeForTask,
  listOwnedWorktrees,
  loadOwnedWorktree,
  loadOwnedWorktreeSandbox,
  loadOwnedWorktreeTask,
  markWorktreeError,
  markWorktreePruned,
  isStaleWorktreeReservation,
  isReservedCheckoutPath,
  reclaimStaleCreatingWorktree,
  reserveWorktree,
} from "./store";
import type { OrchestrationWorktreeDTO, WorktreeCommandResult } from "./types";
import { ACTIVE_SANDBOX_STATUSES } from "@/lib/sandbox/statuses";

export class WorktreeServiceError extends Error {
  readonly forceEligible: boolean;
  readonly kind: "not_found" | "conflict";

  constructor(
    message: string,
    options: {
      forceEligible?: boolean;
      kind?: "not_found" | "conflict";
    } = {}
  ) {
    super(message);
    this.name = "WorktreeServiceError";
    this.forceEligible = options.forceEligible ?? false;
    this.kind = options.kind ?? "conflict";
  }
}

type WorktreeServiceDeps = {
  loadTask: typeof loadOwnedWorktreeTask;
  loadSandbox: typeof loadOwnedWorktreeSandbox;
  findLiveForTask: typeof findLiveWorktreeForTask;
  reserve: typeof reserveWorktree;
  reclaimCreating: typeof reclaimStaleCreatingWorktree;
  execute: typeof executeWorktreeCommand;
  activate: typeof activateWorktree;
  markError: typeof markWorktreeError;
  load: typeof loadOwnedWorktree;
  list: typeof listOwnedWorktrees;
  archive: typeof archiveWorktreeRecord;
  markPruned: typeof markWorktreePruned;
};

const defaultDeps: WorktreeServiceDeps = {
  loadTask: loadOwnedWorktreeTask,
  loadSandbox: loadOwnedWorktreeSandbox,
  findLiveForTask: findLiveWorktreeForTask,
  reserve: reserveWorktree,
  reclaimCreating: reclaimStaleCreatingWorktree,
  execute: executeWorktreeCommand,
  activate: activateWorktree,
  markError: markWorktreeError,
  load: loadOwnedWorktree,
  list: listOwnedWorktrees,
  archive: archiveWorktreeRecord,
  markPruned: markWorktreePruned,
};

function commandFailure(result: WorktreeCommandResult): string | null {
  if (result.exitCode === 0) return null;
  return result.stderr.trim() || result.stdout.trim() || "Git command failed";
}

export async function spawnWorktree(
  input: {
    userId: string;
    runId: string;
    taskId: string;
    sandboxId: string;
  },
  overrides: Partial<WorktreeServiceDeps> = {}
): Promise<OrchestrationWorktreeDTO> {
  const deps = { ...defaultDeps, ...overrides };
  const task = await deps.loadTask(input);
  if (!task) throw new WorktreeServiceError("Orchestration task not found");
  const existing = await deps.findLiveForTask({
    taskId: input.taskId,
    userId: input.userId,
  });
  if (
    existing &&
    (existing.run_id !== task.run_id || existing.repo_id !== task.repo_id)
  ) {
    throw new WorktreeServiceError("Worktree belongs to another mission");
  }
  if (existing && existing.sandbox_id !== input.sandboxId) {
    throw new WorktreeServiceError(
      "Worktree is already reserved in another sandbox"
    );
  }
  if (existing?.status === "active" || existing?.status === "archived") {
    return existing;
  }

  const sandbox = await deps.loadSandbox({
    sandboxId: input.sandboxId,
    userId: input.userId,
    repoId: task.repo_id,
  });
  if (!sandbox) throw new WorktreeServiceError("Sandbox not found");
  if (
    !ACTIVE_SANDBOX_STATUSES.includes(
      sandbox.status as (typeof ACTIVE_SANDBOX_STATUSES)[number]
    )
  ) {
    throw new WorktreeServiceError(
      "Resume the sandbox before creating a worktree"
    );
  }

  let worktree = existing;
  let ownsCreation = existing?.status === "error";
  if (existing?.status === "creating") {
    const reclaimed = await deps.reclaimCreating({
      worktreeId: existing.id,
      userId: input.userId,
      expectedUpdatedAt: existing.updated_at,
    });
    worktree = reclaimed ?? existing;
    ownsCreation = reclaimed !== null;
  }
  if (!worktree) {
    const reservation = await deps.reserve({
      userId: input.userId,
      runId: task.run_id,
      taskId: task.id,
      repoId: task.repo_id,
      sandboxId: sandbox.id,
      agentId: task.agent_id,
      branchName: task.branch_name,
      baseBranch: task.base_branch,
    });
    worktree = reservation.worktree;
    ownsCreation = reservation.created;
    if (worktree.run_id !== task.run_id || worktree.repo_id !== task.repo_id) {
      throw new WorktreeServiceError("Worktree belongs to another mission");
    }
    if (worktree.sandbox_id !== sandbox.id) {
      throw new WorktreeServiceError(
        "Worktree is already reserved in another sandbox"
      );
    }
  }
  if (!ownsCreation) {
    // A concurrent creator still owns the lease. Callers must treat this as a
    // lifecycle snapshot and wait for a later list/stream update before bind.
    return worktree;
  }

  try {
    const result = await deps.execute({
      userId: input.userId,
      sandboxId: sandbox.id,
      command: buildCreateWorktreeCommand({
        worktreeId: worktree.id,
        branchName: worktree.branch_name,
        baseBranch: worktree.base_branch,
      }),
    });
    const failure = commandFailure(result);
    if (failure) throw new WorktreeServiceError(failure);
    const checkoutPath = parseCreatedWorktreePath(result.stdout, worktree.id);
    if (!checkoutPath) {
      throw new WorktreeServiceError(
        "Git did not report the managed worktree path"
      );
    }
    return deps.activate({
      worktreeId: worktree.id,
      userId: input.userId,
      checkoutPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worktree failed";
    await deps.markError({
      worktreeId: worktree.id,
      userId: input.userId,
      error: message,
    });
    throw error;
  }
}

export async function listWorktrees(input: {
  userId: string;
  runId: string;
  repoId?: string | null;
  includePruned?: boolean;
}) {
  return defaultDeps.list(input);
}

async function requireOwnedWorktree(
  input: {
    userId: string;
    worktreeId: string;
    runId: string;
    repoId: string;
  },
  deps: WorktreeServiceDeps
): Promise<OrchestrationWorktreeDTO> {
  const worktree = await deps.load(input);
  if (worktree?.run_id !== input.runId || worktree.repo_id !== input.repoId) {
    throw new WorktreeServiceError("Worktree not found", { kind: "not_found" });
  }
  return worktree;
}

export async function rebaseWorktree(
  input: {
    userId: string;
    worktreeId: string;
    runId: string;
    repoId: string;
  },
  overrides: Partial<WorktreeServiceDeps> = {}
): Promise<OrchestrationWorktreeDTO> {
  const deps = { ...defaultDeps, ...overrides };
  const worktree = await requireOwnedWorktree(input, deps);
  if (worktree.status !== "active") {
    throw new WorktreeServiceError("Only active worktrees can be rebased");
  }
  const result = await deps.execute({
    userId: input.userId,
    sandboxId: worktree.sandbox_id,
    cwd: worktree.checkout_path,
    command: buildRebaseWorktreeCommand({
      baseBranch: worktree.base_branch,
    }),
  });
  const failure = commandFailure(result);
  if (failure) throw new WorktreeServiceError(failure);
  return worktree;
}

export async function diffWorktree(
  input: {
    userId: string;
    worktreeId: string;
    runId: string;
    repoId: string;
  },
  overrides: Partial<WorktreeServiceDeps> = {}
): Promise<{ worktree: OrchestrationWorktreeDTO; diff: string }> {
  const deps = { ...defaultDeps, ...overrides };
  const worktree = await requireOwnedWorktree(input, deps);
  if (worktree.status === "pruned") {
    throw new WorktreeServiceError("Pruned worktrees have no checkout");
  }
  if (isReservedCheckoutPath(worktree.checkout_path)) {
    throw new WorktreeServiceError("Worktree has no checkout yet");
  }
  const result = await deps.execute({
    userId: input.userId,
    sandboxId: worktree.sandbox_id,
    cwd: worktree.checkout_path,
    command: buildWorktreeDiffCommand({ baseBranch: worktree.base_branch }),
  });
  const failure = commandFailure(result);
  if (failure) throw new WorktreeServiceError(failure);
  return { worktree, diff: result.stdout };
}

export async function archiveWorktree(
  input: {
    userId: string;
    worktreeId: string;
    runId: string;
    repoId: string;
  },
  overrides: Partial<WorktreeServiceDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const worktree = await requireOwnedWorktree(input, deps);
  if (worktree.status === "archived") return worktree;
  if (
    worktree.status !== "creating" &&
    worktree.status !== "active" &&
    worktree.status !== "error"
  ) {
    throw new WorktreeServiceError(
      "Only creating, active, or failed worktrees can be archived"
    );
  }
  if (
    worktree.status === "creating" &&
    !isStaleWorktreeReservation(worktree.updated_at)
  ) {
    throw new WorktreeServiceError(
      "Wait for worktree creation to finish before archiving"
    );
  }
  const archived = await deps.archive({
    ...input,
    expectedCreatingUpdatedAt:
      worktree.status === "creating" ? worktree.updated_at : undefined,
  });
  if (!archived) {
    throw new WorktreeServiceError("Worktree changed; refresh and retry");
  }
  return archived;
}

export async function pruneWorktree(
  input: {
    userId: string;
    worktreeId: string;
    runId: string;
    repoId: string;
    force?: boolean;
  },
  overrides: Partial<WorktreeServiceDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const worktree = await requireOwnedWorktree(input, deps);
  if (worktree.status === "pruned") return worktree;
  if (worktree.status !== "archived") {
    throw new WorktreeServiceError("Archive the worktree before pruning it");
  }
  if (isReservedCheckoutPath(worktree.checkout_path)) {
    return deps.markPruned(input);
  }
  try {
    const result = await deps.execute({
      userId: input.userId,
      sandboxId: worktree.sandbox_id,
      command: buildPruneWorktreeCommand({
        checkoutPath: worktree.checkout_path,
        // `force` retires a binding only after the executor confirms the
        // sandbox is gone. It must never turn into `git worktree --force`.
        force: false,
      }),
    });
    const failure = commandFailure(result);
    if (failure) throw new WorktreeServiceError(failure);
  } catch (error) {
    if (error instanceof WorktreeExecutorError && error.status === 404) {
      if (!input.force) {
        throw new WorktreeServiceError(error.message, {
          forceEligible: true,
        });
      }
      console.warn("[worktrees] retiring binding for missing sandbox", {
        worktreeId: worktree.id,
        error: error.message,
      });
    } else {
      throw error;
    }
  }
  return deps.markPruned(input);
}
