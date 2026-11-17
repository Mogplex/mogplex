"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getActiveTeamRequestHeaders } from "@/lib/active-team-request";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { RunWorkspaceContext } from "@/lib/run-workspace/types";
import { deliveryPresentation } from "@/lib/run-delivery/presentation";

export function RunDeliveryStatus({context, onRefresh}: {context: RunWorkspaceContext; onRefresh: () => Promise<unknown>}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receipt = context.delivery;
  const pr = receipt?.pullRequest;
  const labels = deliveryPresentation(context);
  async function refresh() {
    setBusy(true); setError(null);
    try {
      await fetchJsonObject(`/api/runs/${context.runId}/delivery`, "Could not refresh delivery status", {headers: getActiveTeamRequestHeaders()});
      await onRefresh();
    } catch { setError("Could not refresh delivery status. Try again."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Delivery progress" className="shrink-0 border-b border-border bg-secondary/30 px-3 py-2 text-xs">
    <div className="flex items-center justify-between gap-2"><h3 className="font-medium">Delivery progress</h3><Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>{busy ? "Checking…" : "Refresh delivery"}</Button></div>
    {!receipt || !labels ? <p className="text-muted-foreground">Delivery status has not been checked. Agent completion does not confirm a PR, merge, or deployment.</p> : <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Pull request</dt><dd>{pr ? <a className="underline" href={pr.url} target="_blank" rel="noreferrer">{labels.pullRequest}</a> : labels.pullRequest}</dd>
        <dt className="text-muted-foreground">Checks &amp; review</dt><dd>{labels.checks}</dd>
        <dt className="text-muted-foreground">Merge</dt><dd>{labels.merge}</dd>
        <dt className="text-muted-foreground">Production</dt><dd>{labels.production}</dd>
      </dl>
      {labels.notice && <p role="status" className="mt-2 text-muted-foreground">{labels.notice}</p>}
      <p className="mt-1 text-muted-foreground">Checked {new Date(receipt.observedAt).toLocaleString()}</p>
    </>}
    {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
  </section>;
}
