import Link from "next/link"
import { useParams } from "next/navigation"
import type { ObservabilityJobDetail } from "@/lib/types"
import { formatDispatchOutcome, formatDispatchReason, formatCostUsd, formatDuration } from "./formatters"

export function RunTimeline({ run, latestOnly = false }: { run: ObservabilityJobDetail; latestOnly?: boolean }) {
  const events = [
    ...(run.dispatch_events.length ? run.dispatch_events : run.latest_dispatch_event ? [run.latest_dispatch_event] : []).map((event) => ({ id: event.id, at: event.created_at, label: formatDispatchOutcome(event.outcome), detail: formatDispatchReason(event.reason, event.metadata) })),
    ...run.ai_calls.flatMap((call) => call.events.map((event) => ({ id: event.id, at: event.created_at, label: event.tool_name ? `${event.event_type.replaceAll("_", " ")}: ${event.tool_name}` : event.event_type.replaceAll("_", " "), detail: event.message }))),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const visible = latestOnly ? events.slice(-1) : events
  return <section className="space-y-3"><h4 className="text-sm font-medium">{latestOnly ? "Latest recorded activity" : "Execution timeline"}</h4>
    {visible.length === 0 ? <p className="text-sm text-muted-foreground">No detailed events were recorded for this run. Its status above is the latest stored state.</p> : <ol className="divide-y divide-border">{visible.map((event) => <li key={event.id} className="space-y-1 py-3"><p className="text-sm font-medium capitalize">{event.label}</p>{event.detail && <p className="whitespace-pre-wrap break-words text-sm leading-6">{event.detail}</p>}<time className="text-xs text-muted-foreground" dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></li>)}</ol>}
  </section>
}

export function RunUsage({ run }: { run: ObservabilityJobDetail }) {
  const { scope } = useParams<{ scope: string }>()
  return <section className="space-y-3"><h4 className="text-sm font-medium">AI calls ({run.ai_calls.length})</h4><p className="text-sm text-muted-foreground">Recorded usage, not a cost estimate. Missing cost is not zero.</p>
    {run.ai_calls.length === 0 ? <p className="text-sm">No AI calls were recorded.</p> : <ul className="divide-y divide-border">{run.ai_calls.map((call) => <li key={call.id} className="space-y-2 py-3"><Link className="break-all text-sm underline underline-offset-4" href={`/${scope}/observability?view=usage&call_id=${call.id}`}>{call.model}</Link><p className="text-sm tabular-nums">{formatCostUsd(call.cost_usd)} · {formatDuration(call.duration_ms)} · {call.tool_calls_count ?? 0} tools</p><p className="text-xs text-muted-foreground">{call.input_tokens?.toLocaleString() ?? "Unrecorded"} input tokens · {call.output_tokens?.toLocaleString() ?? "Unrecorded"} output tokens</p></li>)}</ul>}
  </section>
}
