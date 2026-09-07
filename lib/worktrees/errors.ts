export class WorktreeServiceError extends Error {
  readonly forceEligible: boolean;
  readonly kind: "not_found" | "conflict";
  readonly reason: WorktreeServiceRejectionReason;

  constructor(
    message: string,
    options: {
      forceEligible?: boolean;
      kind?: "not_found" | "conflict";
      reason?: WorktreeServiceRejectionReason;
    } = {}
  ) {
    super(message);
    this.name = "WorktreeServiceError";
    this.forceEligible = options.forceEligible ?? false;
    this.kind = options.kind ?? "conflict";
    this.reason = options.reason ?? "operation_failed";
  }
}

export type WorktreeServiceRejectionReason =
  | "mission_mismatch"
  | "operation_failed"
  | "sandbox_inactive"
  | "sandbox_mismatch"
  | "sandbox_not_found"
  | "stale_resource"
  | "task_not_found"
  | "worktree_invalid_state"
  | "worktree_not_found";
