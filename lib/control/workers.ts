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
  const diagnostic = [error, ...events.map((event) => event.message)].join(
    "\n"
  );
  if (
    /401|unauthorized|incorrect api key|authentication failed/i.test(diagnostic)
  )
    return "Worker could not authenticate. Check its AI connection before retrying.";
  return "Worker stopped before finishing. Inspect its recorded output before retrying.";
}

export function workerSummary(workers: ControlWorker[]): string {
  const count = (status: MogplexApiRunStatus) =>
    workers.filter((worker) => worker.status === status).length;
  const label = (n: number, suffix: string) =>
    `${n} worker${n === 1 ? "" : "s"} ${suffix}`;
  if (count("failed")) return label(count("failed"), "failed");
  if (count("awaiting_input"))
    return label(count("awaiting_input"), "need input");
  if (count("streaming")) return label(count("streaming"), "running");
  if (count("pending")) return label(count("pending"), "queued");
  if (count("cancelled")) return label(count("cancelled"), "cancelled");
  return "Workers finished. Integration and verification are separate.";
}
