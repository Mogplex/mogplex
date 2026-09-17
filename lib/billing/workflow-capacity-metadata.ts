import type { WorkflowCapacityAdmissionDecision } from "./workflow-capacity";

/** Keep the actual decision separate from the hypothetical enforced decision. */
export function workflowCapacityMetadata(
  capacity: WorkflowCapacityAdmissionDecision
) {
  if (!capacity.tracked) return { capacity_tracking: "unresolved_scope" };
  return {
    billing_account_id: capacity.accountId,
    capacity_accounting_mode: capacity.accountingMode,
    capacity_admitted: capacity.admitted,
    capacity_enforcement_active: capacity.accountingMode === "enforced",
    capacity_would_admit: capacity.wouldAdmit,
    active_concurrency_before: capacity.activeBefore,
    concurrency_limit: capacity.concurrencyLimit,
  };
}
