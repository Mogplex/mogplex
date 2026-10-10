"use client";

import { useId, useMemo, useState } from "react";
import { useAiCallEvents, useObservabilityCalls } from "@/hooks/use-observability";
import { agentTerminalEntries } from "@/lib/terminal/agent-activity";

export function AgentCommands({ repoId, sandboxId }: { repoId?: string; sandboxId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const outputId = useId();
  const { data, error, isLoading, refresh } = useObservabilityCalls(repoId && sandboxId ? {
    repoId, sandboxRecordId: sandboxId, page: 1, limit: 20, sort: "started_at", order: "desc",
  } : null);
  const calls = data?.calls ?? [];
  const call = calls.find(item => item.id === selectedId) ?? calls[0];
  const { events, error: eventError, isLoading: loadingEvents, refresh: refreshEvents } = useAiCallEvents(call?.id ?? null);
  const entries = useMemo(() => call ? agentTerminalEntries(call.id, call.status, events) : [], [call, events]);
  const latest = entries.at(-1);
  const failed = error || eventError;
  const loading = isLoading || loadingEvents;

  return <section aria-label="Agent commands" className="flex max-h-[60%] shrink-0 flex-col overflow-hidden border-b border-border bg-card text-xs">
    <button type="button" aria-label={expanded ? "Hide agent output" : "Show agent output"} aria-expanded={expanded} aria-controls={outputId}
      onClick={() => setExpanded(value => !value)} className="flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <span className="shrink-0 font-medium">Agent commands</span>
      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{!expanded && (loading ? "Loading…" : failed ? "Unable to load" : latest?.command ?? (sandboxId ? "No commands recorded" : "No sandbox selected"))}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">Read only</span>
      <span aria-hidden>{expanded ? "−" : "+"}</span>
    </button>
    <div id={outputId} hidden={!expanded} className="min-h-0 max-h-48 space-y-3 overflow-auto px-3 pb-3">
      {calls.length > 0 && <label className="flex flex-wrap items-center gap-2 text-muted-foreground">
        Recent run
        <select aria-label="Agent run" value={call?.id ?? ""} onChange={event => setSelectedId(event.target.value)} className="min-w-0 max-w-full rounded border border-border bg-background px-2 py-1 text-foreground">
          {calls.map(item => <option key={item.id} value={item.id}>{new Date(item.started_at).toLocaleString()} · {item.model} · {item.status}</option>)}
        </select>
      </label>}
      {failed ? <p role="alert" className="text-destructive">Unable to load agent commands. <button type="button" className="underline" onClick={() => void Promise.all([refresh(), refreshEvents()]).catch(() => {})}>Retry</button></p> :
        loading ? <p role="status" className="text-muted-foreground">Loading recorded commands…</p> :
        entries.length === 0 ? <p className="text-muted-foreground">{sandboxId ? "No agent commands have been recorded for this run." : "Select a sandbox to see its agent commands."}</p> :
        entries.map(entry => <div key={entry.id} className="space-y-1 font-mono">
          <div className="flex items-start gap-2"><span aria-hidden>$</span><pre className="min-w-0 flex-1 whitespace-pre-wrap break-words">{entry.command}</pre><span className={entry.state === "failed" ? "text-destructive" : "text-muted-foreground"}>{entry.state === "running" ? "Running" : entry.state === "failed" ? "Failed" : "Complete"}</span></div>
          <pre className="whitespace-pre-wrap break-words text-muted-foreground">{entry.lines.length ? entry.lines.join("\n") : entry.state === "running" ? "Waiting for recorded output…" : "No output recorded."}</pre>
        </div>)}
    </div>
  </section>;
}
