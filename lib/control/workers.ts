import type { MogplexApiRunStatus } from "@/lib/mogplex-api/runs-types";
import type { RunWorkspaceEvent } from "@/lib/run-workspace/types";

export type ControlWorker = {
  id: string;
  worktreeId: string;
  branch: string;
  status: MogplexApiRunStatus;
  error: string | null;
  updatedAt: string;
  events: RunWorkspaceEvent[];
};

export function workerFailureMessage(
  status: MogplexApiRunStatus,
  error: string | null,
  events: RunWorkspaceEvent[]
): string | null {
  if (status !== "failed") return null;
  if (
    /development environment stopped|sandbox.*(?:stopped|gone)|session.*(?:stopped|gone)/i.test(
      error ?? ""
    )
  )
    return "The development environment stopped before the worker finished. Restart it and retry the worker.";
  if (
    /invalid request:.*duration|runtime.*(?:unavailable|failed)/i.test(
      error ?? ""
    )
  )
    return "The worker could not start because of a runtime error. Retry the worker.";
  const diagnostic = [error, ...events.map((event) => event.message)].join(
    "\n"
  );
  if (
    /\b(?:unauthorized|incorrect api key|authentication failed)\b/i.test(
      diagnostic
    ) ||
    /\b(?:HTTP(?:\/[\d.]+)?|status(?:\s+code)?)\s*[:=]?\s*401\b/i.test(
      diagnostic
    )
  )
    return "Worker could not authenticate. Check its AI connection before retrying.";
  return "Worker stopped before finishing. Inspect its recorded output before retrying.";
}

export function workerSummary(workers: ControlWorker[]): string {
  const count = (status: MogplexApiRunStatus) =>
    workers.filter((worker) => worker.status === status).length;
  const label = (n: number, suffix: string) =>
    `${n} worker${n === 1 ? "" : "s"} ${suffix}`;
  const states = [
    ["streaming", "running"],
    ["pending", "queued"],
    ["awaiting_input", "need input"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
  ] as const;
  const summary = states
    .filter(([status]) => count(status) > 0)
    .map(([status, suffix]) => label(count(status), suffix));
  return (
    summary.join(" · ") ||
    "Workers finished. Integration and verification are separate."
  );
}
