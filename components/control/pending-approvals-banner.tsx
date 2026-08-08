"use client"

import { useState } from "react"
import useSWR from "swr"
import type { ControlApprovalRow } from "@/lib/control/approvals-store"
import { Check, XmarkCircle, WarningCircle } from "iconoir-react"

type Props = {
  runId?: string | null
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}`)
  return res.json()
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diffMs = now - date
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function ApprovalRow({
  approval,
  onResolved,
}: {
  approval: ControlApprovalRow
  onResolved: () => void
}) {
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resolve = async (decision: "approve" | "deny") => {
    setSubmitting(decision)
    setError(null)
    try {
      const res = await fetch(`/api/control/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(
          (body as { error?: string } | null)?.error ?? "Failed to send decision"
        )
      }
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send decision")
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-600 dark:text-amber-400">
          {approval.tool_name}
        </span>
        <span className="text-xs">{approval.summary}</span>
        <span className="text-[10px] text-muted-foreground">
          {timeAgo(approval.created_at)}
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note"
          maxLength={500}
          disabled={submitting !== null}
          className="flex-1 min-w-24 rounded border border-border bg-background px-2 py-1 text-[10px] placeholder:text-muted-foreground/50 disabled:opacity-50"
        />
        <div className="flex gap-1.5">
          <button
            onClick={() => resolve("approve")}
            disabled={submitting !== null}
            className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-brand-accent-hover disabled:opacity-50"
          >
            <Check className="size-3" />
            {submitting === "approve" ? "..." : "Approve"}
          </button>
          <button
            onClick={() => resolve("deny")}
            disabled={submitting !== null}
            className="flex items-center gap-1 rounded border border-accent-red/30 bg-accent-red/5 px-2 py-1 text-[10px] font-medium text-accent-red hover:bg-accent-red/10 disabled:opacity-50"
          >
            <XmarkCircle className="size-3" />
            {submitting === "deny" ? "..." : "Deny"}
          </button>
        </div>
      </div>
      {error && <p className="text-[10px] text-accent-red">{error}</p>}
    </div>
  )
}

/**
 * Banner shown above the timeline when there are pending approvals from the
 * durable store. Covers reconnect/headless cases where the stream part is gone.
 * Polls every 5 seconds.
 */
export function PendingApprovalsBanner({ runId }: Props) {
  const apiUrl = runId
    ? `/api/control/approvals?runId=${encodeURIComponent(runId)}`
    : "/api/control/approvals"

  const { data, mutate } = useSWR<{ approvals: ControlApprovalRow[] }>(
    apiUrl,
    fetcher,
    { refreshInterval: 5_000 }
  )

  const approvals = data?.approvals ?? []
  if (approvals.length === 0) return null

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-2">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
          <WarningCircle className="size-4 text-amber-500" />
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {approvals.length} pending approval{approvals.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="divide-y divide-amber-500/10">
          {approvals.map((approval) => (
            <ApprovalRow
              key={approval.id}
              approval={approval}
              onResolved={() => mutate()}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
