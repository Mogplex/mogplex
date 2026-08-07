import type { FlowRunDetail, FlowRunRecord } from "../../../lib/types";
import type { RunActionDescriptor } from "../../../lib/flows/run-presentation";

export type ActionableRunFixture = Pick<
  FlowRunRecord,
  "status" | "cancelable" | "repairable" | "requeueable"
>;

export type ReviewedTargetRunFixture = Pick<FlowRunRecord, "repo" | "metadata">;

export type CancellationStateFixture = Pick<
  FlowRunDetail,
  | "cancel_requested_at"
  | "cancelled_at"
  | "cancel_reason"
  | "cancel_error"
  | "dispatch_events"
>;

export const CANCEL_DESCRIPTOR = {
  action: "cancel",
  label: "Cancel",
  emphasis: "destructive",
} satisfies RunActionDescriptor;

export const RETRY_DESCRIPTOR = {
  action: "requeue",
  label: "Retry",
  emphasis: "secondary",
} satisfies RunActionDescriptor;

export const PRIMARY_REPAIR_DESCRIPTOR = {
  action: "repair",
  label: "Repair",
  emphasis: "primary",
} satisfies RunActionDescriptor;

export const SECONDARY_REPAIR_DESCRIPTOR = {
  action: "repair",
  label: "Repair",
  emphasis: "secondary",
} satisfies RunActionDescriptor;

export function buildActionableRun(
  run: Partial<ActionableRunFixture> & Pick<ActionableRunFixture, "status">
): ActionableRunFixture {
  const { status, ...overrides } = run;

  return {
    status,
    cancelable: false,
    repairable: false,
    requeueable: false,
    ...overrides,
  };
}

export function buildReviewedTargetRun(
  overrides: Partial<ReviewedTargetRunFixture> = {}
): ReviewedTargetRunFixture {
  return {
    repo: { id: "repo-1", full_name: "webrenew/mogplex" },
    metadata: { pr_number: 138 },
    ...overrides,
  };
}

export function buildCancellationStateRun(
  overrides: Partial<CancellationStateFixture> = {}
): CancellationStateFixture {
  return {
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    dispatch_events: [],
    ...overrides,
  };
}

export const runActionScenarios: Array<{
  name: string;
  run: ActionableRunFixture;
  expected: RunActionDescriptor[];
  emptyState?: string;
}> = [
  {
    name: "running runs only expose cancel when cancelable",
    run: buildActionableRun({ status: "running", cancelable: true }),
    expected: [CANCEL_DESCRIPTOR],
  },
  {
    name: "running runs without cancellation support expose no actions",
    run: buildActionableRun({ status: "running" }),
    expected: [],
    emptyState: "This run is active, and no controls are currently available.",
  },
  {
    name: "stale pending runs keep repair available alongside cancel",
    run: buildActionableRun({
      status: "pending",
      cancelable: true,
      repairable: true,
    }),
    expected: [PRIMARY_REPAIR_DESCRIPTOR, CANCEL_DESCRIPTOR],
  },
  {
    name: "pending runs can expose repair without cancel",
    run: buildActionableRun({ status: "pending", repairable: true }),
    expected: [PRIMARY_REPAIR_DESCRIPTOR],
  },
  {
    name: "pending runs can expose cancel without repair",
    run: buildActionableRun({ status: "pending", cancelable: true }),
    expected: [CANCEL_DESCRIPTOR],
  },
  {
    name: "pending runs without repair or cancellation support expose no actions",
    run: buildActionableRun({ status: "pending" }),
    expected: [],
    emptyState: "This run is active, and no controls are currently available.",
  },
  {
    name: "failed runs prioritize retry and render follow-up actions secondary",
    run: buildActionableRun({
      status: "failed",
      repairable: true,
      requeueable: true,
    }),
    expected: [RETRY_DESCRIPTOR, SECONDARY_REPAIR_DESCRIPTOR],
  },
  {
    name: "failed runs can surface retry without repair",
    run: buildActionableRun({ status: "failed", requeueable: true }),
    expected: [RETRY_DESCRIPTOR],
  },
  {
    name: "failed runs can surface repair without retry",
    run: buildActionableRun({ status: "failed", repairable: true }),
    expected: [SECONDARY_REPAIR_DESCRIPTOR],
  },
  {
    name: "failed runs without repair or retry expose no actions",
    run: buildActionableRun({ status: "failed" }),
    expected: [],
    emptyState: "This run cannot be retried or repaired from here.",
  },
  {
    name: "successful runs ignore stale action flags",
    run: buildActionableRun({
      status: "success",
      cancelable: true,
      repairable: true,
      requeueable: true,
    }),
    expected: [],
    emptyState: "Completed runs do not have follow-up actions.",
  },
  {
    name: "cancelled runs ignore stale action flags",
    run: buildActionableRun({
      status: "cancelled",
      cancelable: true,
      repairable: true,
      requeueable: true,
    }),
    expected: [],
    emptyState: "This run is already cancelled.",
  },
];
