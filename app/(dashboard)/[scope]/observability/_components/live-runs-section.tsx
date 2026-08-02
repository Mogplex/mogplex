"use client"

import { presentSandboxDebug } from "@/lib/sandbox/debug-presenter"
import type { AiCall } from "@/lib/types"
import { StatusBadge } from "./badges"
import { CALL_TYPE_LABELS, timeAgo } from "./formatters"

function SandboxBillingBadge({
  source,
  label,
}: {
  source: NonNullable<AiCall["sandbox_context"]>["compute_billing_source"]
  label: string
}) {
  const classes = source === "user_vercel_project"
    ? "bg-accent-blue/10 text-accent-blue border-accent-blue/20"
    : "bg-muted text-muted-foreground border-border"

  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${classes}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

export function LiveRunsSection({
  liveInteractiveCalls,
  liveCallsLoading,
}: {
  liveInteractiveCalls: AiCall[]
  liveCallsLoading: boolean
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="ui-section-title">Live Runs</h2>
          <p className="ui-meta">Interactive chat and harness runs that are currently pending or streaming.</p>
        </div>
        {liveCallsLoading && <span className="text-sm text-muted-foreground animate-pulse">Loading live runs…</span>}
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        {liveInteractiveCalls.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No live interactive runs</div>
        ) : (
          <div className="divide-y divide-border">
            {liveInteractiveCalls.map((call) => (
              <div key={call.id} className="px-4 py-3 flex items-center gap-3">
                <StatusBadge status={call.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-foreground">{CALL_TYPE_LABELS[call.type] || call.type}</div>
                    {call.sandbox_context && (
                      <SandboxBillingBadge
                        source={call.sandbox_context.compute_billing_source}
                        label={presentSandboxDebug({ sandboxContext: call.sandbox_context }).computeBillingBadgeLabel}
                      />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {call.model} · {call.conversation_id || "no conversation"} · {timeAgo(call.started_at)}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground text-right">
                  {call.type === "agent" ? "server-cancellable" : "client-cancellable"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
