"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { scopedHref } from "@/lib/scoped-href";
import { workerSummary, type ControlWorker } from "@/lib/control/workers";

const LABELS = {
  pending: "Queued", streaming: "Running", success: "Finished",
  failed: "Failed", cancelled: "Cancelled", awaiting_input: "Needs input",
};

export function MissionWorkers({ workers, error, loading, onRefresh, compact = false }: {
  compact?: boolean;
  workers: ControlWorker[];
  error: string | null;
  loading: boolean;
  onRefresh: () => unknown;
}) {
  const { scope } = useParams<{ scope: string }>();
  const commonError = workers.length > 1 && workers.every((worker) => worker.error && worker.error === workers[0].error) ? workers[0].error : null;
  if (!workers.length && !error && !loading) return null;
  return (
    <section aria-label="Mission workers" className="border-ink-800 mt-4 min-w-0 border-t py-4">
      <p role="status" className="text-ink-200 text-sm font-medium">
        {workers.length ? workerSummary(workers) : loading ? "Loading worker status…" : "Worker status unavailable"}
      </p>
      {commonError && <p className="text-destructive mt-2 max-w-prose text-xs">{commonError}</p>}
      {error && <div className="text-accent-amber mt-2 text-xs">
        <p>{error} {workers.length > 0 && "Showing last received status."}</p>
        <button type="button" onClick={() => onRefresh()} className="mt-1 underline underline-offset-4">Refresh status</button>
      </div>}
      <details key={String(compact)} open={!compact || workers.some((worker) => ["pending", "streaming", "awaiting_input"].includes(worker.status))} className="mt-2">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">Worker details and recorded output</summary>
      <ul className="mt-3 space-y-3">
        {workers.map((worker) => <li key={worker.id} className="min-w-0 text-xs">
          <div className="flex min-w-0 gap-3">
            <span className="text-foreground min-w-0 flex-1 break-words">{worker.branch.split("/").at(-1)?.replaceAll("-", " ")}</span>
            <span className={worker.status === "failed" ? "text-accent-red" : "text-ink-300"}>{LABELS[worker.status]}</span>
            <Link href={scopedHref(scope, `/projects/workspace?run=${encodeURIComponent(worker.id)}`)} className="text-accent-blue shrink-0 underline underline-offset-4" aria-label={`View work for ${worker.branch}`}>View work</Link>
          </div>
          {worker.error && !commonError && <p className="text-accent-red mt-1 max-w-prose">{worker.error}</p>}
        </li>)}
      </ul>
      </details>
    </section>
  );
}
