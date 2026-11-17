import type { RunWorkspaceContext } from "@/lib/run-workspace/types";
import { deliveryNeedsRepair } from "./types";

export function deliveryPresentation(context: RunWorkspaceContext) {
  const receipt = context.delivery;
  if (!receipt) return null;
  const pr = receipt.pullRequest;
  let checks = "Not available";
  if (pr) {
    checks =
      receipt.checks.state === "failure"
        ? `Checks failing${receipt.checks.failed.length > 0 ? `: ${receipt.checks.failed.join(", ")}` : ""}`
        : receipt.checks.state === "pending"
          ? "Checks running"
          : receipt.checks.state === "success"
            ? "Checks passed"
            : "Checks not confirmed";
    if (pr.state === "open") {
      if (
        receipt.review.unresolved > 0 ||
        receipt.review.state === "changes_requested"
      )
        checks += " · Review needs attention";
      else if (receipt.review.state === "required")
        checks += " · Review required";
      else if (receipt.review.incomplete || receipt.review.state === "unknown")
        checks += " · Review not confirmed";
    }
  }
  const production = {
    success: "Deployment reported successful",
    failure: "Deployment failed",
    pending: "Deployment in progress",
    unavailable: "Could not check deployment",
    inactive: "Deployment inactive",
    not_reported: "No deployment reported",
  }[receipt.deployment.state];
  let notice: string | null = null;
  const needsRepair = deliveryNeedsRepair(receipt);
  if (
    needsRepair &&
    (!context.deliveryFollowThrough ||
      context.status === "failed" ||
      (context.status === "success" &&
        context.deliveryLastRepairRevision === receipt.repairRevision))
  )
    notice =
      "Needs attention. Review the agent’s latest message for the blocker; the same failure is not retried automatically.";
  else if (context.deliveryFollowThrough && pr?.state === "open")
    notice =
      context.status === "streaming"
        ? "Agent is following up on this PR."
        : needsRepair
          ? "CI or review needs follow-up."
          : "Watching GitHub for CI and review updates.";
  return {
    pullRequest: pr
      ? `#${pr.number} · ${pr.draft ? "Draft" : pr.state === "merged" ? "Merged" : pr.state === "closed" ? "Closed" : "Open"}`
      : "No pull request found",
    checks,
    merge:
      pr?.state === "merged"
        ? "Merged"
        : pr?.state === "closed"
          ? "Closed without merging"
          : "Not merged",
    production,
    notice,
  };
}
