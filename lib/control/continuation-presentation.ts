import type { ControlContinuation } from "./continuation-store";

export type ControlContinuationSummary = Pick<
  ControlContinuation,
  "id" | "status" | "error" | "parent_ready" | "updated_at" | "worker_run_ids"
>;
export function controlContinuationSummary(
  ticket: ControlContinuation
): ControlContinuationSummary {
  const { id, status, error, parent_ready, updated_at, worker_run_ids } =
    ticket;
  return { id, status, error, parent_ready, updated_at, worker_run_ids };
}
export function presentControlContinuation(ticket: ControlContinuationSummary) {
  const labels = {
    waiting: ticket.parent_ready
      ? "Waiting for workers"
      : "Saving the coordinator handoff",
    ready: ticket.error
      ? "Follow-up could not start"
      : "Coordinator follow-up queued",
    running: "Coordinator is reviewing the results",
    finished: "Coordinator reply saved",
    needs_input: "Your approval is needed",
    failed: "Coordinator follow-up stopped",
    cancelled: "Coordinator follow-up cancelled",
  };
  const descriptions = {
    waiting:
      "The coordinator will resume here automatically when these workers finish. You can leave this page.",
    ready:
      "The coordinator will continue the original request here. No new prompt is needed.",
    running:
      "New steps and replies appear in this conversation as they are saved.",
    finished:
      "Read the latest reply for the outcome and any remaining work. This status alone does not mean the mission is complete.",
    needs_input:
      "Review the requested action in the conversation before work continues.",
    failed:
      "Your saved conversation and worker output remain available. Review them before asking the coordinator to continue.",
    cancelled:
      "This stops the coordinator follow-up only. Workers and sandbox are unchanged.",
  };
  return {
    label: labels[ticket.status],
    description: ticket.error ?? descriptions[ticket.status],
    cancelable: ["waiting", "ready", "running"].includes(ticket.status),
    retryable: ticket.status === "ready" && Boolean(ticket.error),
    attention:
      ticket.status === "failed" ||
      ticket.status === "needs_input" ||
      Boolean(ticket.error),
  };
}
