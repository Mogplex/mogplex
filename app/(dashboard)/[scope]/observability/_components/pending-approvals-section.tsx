"use client"

import { useId, useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type {
  FlowAwaitEventConfig,
  FlowToolApprovalWaitConfig,
} from "@/lib/types"
import { timeAgo } from "./formatters"
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh"

type PendingApproval = {
  id: string
  job_run_id: string
  flow_id: string
  node_id: string
  wait_config:
    | FlowToolApprovalWaitConfig
    | Extract<FlowAwaitEventConfig, { kind: "manual_approval" }>
  created_at: string
  expires_at: string | null
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}`)
  return res.json()
}

function expiresIn(expiresAt: string | null): string | null {
  if (!expiresAt) return null
  const remainingMs = new Date(expiresAt).getTime() - Date.now()
  if (remainingMs <= 0) return "expiring"
  const minutes = Math.floor(remainingMs / 60_000)
  const seconds = Math.floor((remainingMs % 60_000) / 1_000)
  return minutes > 0 ? `${minutes}m ${seconds}s left` : `${seconds}s left`
}

function PendingApprovalRow({
  approval,
  onResolved,
}: {
  approval: PendingApproval
  onResolved: () => void
}) {
  const [note, setNote] = useState("")
  const noteId = useId()
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showInput, setShowInput] = useState(false)
  const config = approval.wait_config
  const isToolApproval = config.kind === "tool_approval"

  const resolve = async (decision: "approve" | "deny") => {
    setSubmitting(decision)
    setError(null)
    try {
      const res = await fetch(`/api/flows/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? "Failed to send the decision")
      }
      onResolved()
    } catch (resolveError) {
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : "Failed to send the decision"
      )
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/10 px-2 py-0.5 font-mono text-xs font-medium text-[var(--accent-amber)]">
          {isToolApproval ? config.toolName : "Manual approval"}
        </span>
        <span className="text-sm text-foreground">
          {isToolApproval ? (config.nodeLabel ?? "Agent") : config.prompt}
          {isToolApproval && config.agentName ? ` · ${config.agentName}` : ""}
        </span>
        <span className="text-xs text-muted-foreground">
          {isToolApproval && config.repoFullName ? `${config.repoFullName} · ` : ""}
          requested {timeAgo(approval.created_at)}
          {expiresIn(approval.expires_at)
            ? ` · ${expiresIn(approval.expires_at)}`
            : ""}
        </span>
      </div>

      {isToolApproval && (
        <>
          <button
            type="button"
            className="text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowInput((v) => !v)}
          >
            {showInput ? "Hide tool input" : "Show tool input"}
          </button>
          {showInput && (
            <pre className="max-h-48 overflow-auto rounded bg-muted/50 px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
              {config.toolInput}
            </pre>
          )}
        </>
      )}

      <div className="flex flex-wrap items-start gap-2">
        <label htmlFor={noteId} className="sr-only">Decision note</label>
        <Textarea
          id={noteId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            isToolApproval
              ? "Optional note to the agent — steer the approved call, or say what to do instead"
              : "Optional decision note"
          }
          maxLength={2000}
          rows={1}
          className="min-h-9 flex-1 basis-64 text-xs"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={submitting !== null}
            onClick={() => resolve("approve")}
          >
            {submitting === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={submitting !== null}
            onClick={() => resolve("deny")}
          >
            {submitting === "deny" ? "Denying…" : "Deny"}
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// Human workflow decisions. Renders nothing while no run is waiting so the
// page stays uncluttered.
export function PendingApprovalsSection({ showEmpty = false }: { showEmpty?: boolean }) {
  const { data, mutate, error, isLoading } = useSWR<{
    approvals: PendingApproval[]
    hasMore?: boolean
  }>("/api/flows/approvals", fetcher, { shouldRetryOnError: false })
  useRealtimeRouteRefresh({ channelName: "observability-approvals", specs: [{ table: "flow_waits", filter: "user_id=eq.$USER_ID" }, { table: "job_runs" }], onInvalidate: mutate })
  const approvals = data?.approvals ?? []
  if (error) return <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">Approval requests could not be loaded.<Button variant="outline" onClick={() => void mutate()}>Try again</Button></div>
  if (isLoading) return showEmpty ? <p role="status" className="text-sm">Loading approval requests…</p> : null
  if (approvals.length === 0) return showEmpty ? <section className="space-y-2"><h2 className="text-base font-semibold">Approval requests</h2><p className="text-sm text-muted-foreground">No workflow approval requests are waiting for your decision.</p></section> : null

  return (
    <section className="space-y-3">
      <div>
        <h2 className="ui-section-title">Pending approvals</h2>
        <p className="ui-meta">
          A workflow is paused and waiting for your decision. Manual gates stop
          the run when denied; unanswered requests follow the node timeout
          path.
        </p>
      </div>
      <div className="border border-amber-500/40 rounded-md overflow-hidden">
        <div className="divide-y divide-border">
          {approvals.map((approval) => (
            <PendingApprovalRow
              key={approval.id}
              approval={approval}
              onResolved={() => mutate()}
            />
          ))}
        </div>
        {data?.hasMore && (
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            More approvals are pending — this list shows the oldest first.
            Resolving these reveals the rest.
          </div>
        )}
      </div>
    </section>
  )
}
