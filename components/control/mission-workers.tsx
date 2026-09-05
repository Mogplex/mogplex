"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { scopedHref } from "@/lib/scoped-href";
import { workerSummary, type ControlWorker } from "@/lib/control/workers";

const LABELS = {
  pending: "Queued", streaming: "Running", success: "Finished",
  failed: "Failed", cancelled: "Cancelled", awaiting_input: "Needs input",
};

export function MissionWorkers({ workers, error, loading, onRefresh }: {
  workers: ControlWorker[];
  error: string | null;
  loading: boolean;
  onRefresh: () => unknown;
}) {
  const { scope } = useParams<{ scope: string }>();
  if (!workers.length && !error && !loading) return null;
  return (
    <section aria-label="Mission workers" className="border-ink-800 mt-4 min-w-0 border-t py-4">
      <p role="status" className="text-ink-200 text-sm font-medium">
        {workers.length ? workerSummary(workers) : loading ? "Loading worker status…" : "Worker status unavailable"}
      </p>
      {error && <div className="text-accent-amber mt-2 text-xs">
        <p>{error} {workers.length > 0 && "Showing last received status."}</p>
        <button type="button" onClick={() => onRefresh()} className="mt-1 underline underline-offset-4">Refresh status</button>
      </div>}
      <ul className="mt-2 space-y-2">
        {workers.map((worker) => <li key={worker.id} className="min-w-0 text-xs">
          <div className="flex min-w-0 gap-3">
            <span className="text-ink-400 min-w-0 flex-1 break-all font-mono">{worker.branch}</span>
            <span className={worker.status === "failed" ? "text-accent-red" : "text-ink-300"}>{LABELS[worker.status]}</span>
            <Link href={scopedHref(scope, `/projects/workspace?run=${encodeURIComponent(worker.id)}`)} className="text-accent-blue shrink-0 underline underline-offset-4" aria-label={`View work for ${worker.branch}`}>View work</Link>
          </div>
          {worker.error && <p className="text-accent-red mt-1 max-w-prose">{worker.error}</p>}
        </li>)}
      </ul>
    </section>
  );
}
