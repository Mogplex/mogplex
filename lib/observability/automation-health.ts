import { successTone } from "./stat-card-tone";

export type AutomationHealthStatus =
  | "healthy"
  | "needs_attention"
  | "no_activity";

export function getAutomationHealthStatus(input: {
  failedInRange: number;
  stalePending: number;
  runSuccessRate: number | null;
}): AutomationHealthStatus {
  const { failedInRange, stalePending, runSuccessRate } = input;

  // Historical dispatch events are deliberately absent from this input. Only
  // current run state and concluded-run reliability determine health.
  if (
    failedInRange > 0 ||
    stalePending > 0 ||
    (runSuccessRate !== null && successTone(runSuccessRate) === "failure")
  ) {
    return "needs_attention";
  }

  return runSuccessRate === null ? "no_activity" : "healthy";
}
