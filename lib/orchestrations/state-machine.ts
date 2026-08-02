import {
  isTerminalRunStatus,
  isTerminalTaskStatus,
  type OrchestrationRunStatus,
  type OrchestrationTaskStatus,
} from "./status";

type TransitionEntity = "run" | "task";

export class OrchestrationTransitionError extends Error {
  readonly entity: TransitionEntity;
  readonly from: OrchestrationRunStatus | OrchestrationTaskStatus;
  readonly to: OrchestrationRunStatus | OrchestrationTaskStatus;

  constructor(
    entity: TransitionEntity,
    from: OrchestrationRunStatus | OrchestrationTaskStatus,
    to: OrchestrationRunStatus | OrchestrationTaskStatus
  ) {
    super(`Invalid orchestration ${entity} transition from ${from} to ${to}`);
    Object.setPrototypeOf(this, OrchestrationTransitionError.prototype);
    this.name = "OrchestrationTransitionError";
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

const RUN_TRANSITIONS: Record<
  OrchestrationRunStatus,
  OrchestrationRunStatus[]
> = {
  drafting_master_spec: ["awaiting_master_approval", "failed", "cancelled"],
  awaiting_master_approval: [
    "generating_sub_specs",
    "drafting_master_spec",
    "failed",
    "cancelled",
  ],
  generating_sub_specs: ["awaiting_task_approval", "failed", "cancelled"],
  awaiting_task_approval: [
    "generating_sub_specs",
    "launching_sandboxes",
    "failed",
    "cancelled",
  ],
  launching_sandboxes: ["running_tasks", "failed", "cancelled"],
  running_tasks: ["integrating", "failed", "cancelled"],
  integrating: ["conflict_resolution", "validating", "failed", "cancelled"],
  conflict_resolution: ["integrating", "validating", "failed", "cancelled"],
  validating: ["ready_for_pr", "integrating", "failed", "cancelled"],
  ready_for_pr: ["pr_open", "failed", "cancelled"],
  pr_open: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [
    // Awaiting-master-approval is intentionally omitted; approval failures
    // must re-enter drafting before returning to the approval gate.
    "drafting_master_spec",
    "generating_sub_specs",
    "awaiting_task_approval",
    "launching_sandboxes",
    "running_tasks",
    "integrating",
    "conflict_resolution",
    "validating",
    "cancelled",
  ],
  cancelled: [],
};

const TASK_TRANSITIONS: Record<
  OrchestrationTaskStatus,
  OrchestrationTaskStatus[]
> = {
  planned: ["queued", "failed", "cancelled"],
  queued: ["launching_sandbox", "running", "failed", "cancelled"],
  launching_sandbox: ["running", "failed", "cancelled"],
  running: ["needs_user", "pushed", "failed", "cancelled"],
  needs_user: ["running", "pushed", "failed", "cancelled"],
  pushed: ["merge_ready", "merged", "conflict", "failed"],
  merge_ready: ["merged", "conflict", "failed"],
  merged: [],
  conflict: ["merge_ready", "merged", "running", "failed", "cancelled"],
  failed: ["queued", "launching_sandbox", "running", "cancelled"],
  cancelled: [],
};

export function canTransitionRun(
  from: OrchestrationRunStatus,
  to: OrchestrationRunStatus
): boolean {
  // Non-terminal self-transitions model idempotent status writes; terminal
  // states stay closed once a run has completed or been cancelled. This keeps
  // failed -> failed valid for repeated failure metadata writes.
  if (from === to) return !isTerminalRunStatus(from);
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(
  from: OrchestrationRunStatus,
  to: OrchestrationRunStatus
): void {
  if (!canTransitionRun(from, to)) {
    throw new OrchestrationTransitionError("run", from, to);
  }
}

export function canTransitionTask(
  from: OrchestrationTaskStatus,
  to: OrchestrationTaskStatus
): boolean {
  // Non-terminal self-transitions model idempotent status writes; terminal
  // states stay closed once a task has merged or been cancelled.
  if (from === to) return !isTerminalTaskStatus(from);
  return TASK_TRANSITIONS[from].includes(to);
}

export function assertTaskTransition(
  from: OrchestrationTaskStatus,
  to: OrchestrationTaskStatus
): void {
  if (!canTransitionTask(from, to)) {
    throw new OrchestrationTransitionError("task", from, to);
  }
}
