"use client"

import { useState } from "react"
import { MessageResponse } from "@/components/ai-elements/message"
import { PatchViewer } from "@/components/diffs/patch-viewer"
import {
  User,
  Notes,
  Cpu,
  Tools,
  GitBranch,
  WarningTriangle,
  ArrowSeparateVertical,
  CheckCircle,
  XmarkCircle,
  Rocket,
  HelpCircle,
  Check,
  RefreshDouble,
} from "iconoir-react"
import type { TimelineEvent, Worktree, PlanEvent, DelegateEvent, DiffEvent, FailEvent, CompareEvent, ApprovalEvent } from "@/lib/control/types"

export type ToolApprovalResponse = {
  approvalId: string
  toolCallId: string
  approved: boolean
  reason?: string
}

type Props = {
  event: TimelineEvent
  eventIndex: number
  getWorktree: (id: string) => Worktree | undefined
  onApprove: (eventIndex: number) => void
  onToolApprovalResponse?: (response: ToolApprovalResponse) => void
}

const KIND_STYLES: Record<string, { icon: typeof User; bg: string; fg: string; labelColor: string }> = {
  user: { icon: User, bg: "bg-ink-800", fg: "text-ink-300", labelColor: "text-ink-300" },
  assistant: { icon: Cpu, bg: "bg-ink-800", fg: "text-ink-200", labelColor: "text-ink-200" },
  progress: { icon: CheckCircle, bg: "bg-accent-blue/10", fg: "text-accent-blue", labelColor: "text-accent-blue" },
  plan: { icon: Notes, bg: "bg-ink-800", fg: "text-ink-300", labelColor: "text-ink-300" },
  delegate: { icon: Cpu, bg: "bg-ink-800", fg: "text-ink-300", labelColor: "text-ink-300" },
  tool: { icon: Tools, bg: "bg-ink-800", fg: "text-ink-400", labelColor: "text-ink-400" },
  diff: { icon: GitBranch, bg: "bg-ink-800", fg: "text-ink-300", labelColor: "text-ink-300" },
  fail: { icon: XmarkCircle, bg: "bg-accent-red/10", fg: "text-accent-red", labelColor: "text-accent-red" },
  conflict: { icon: WarningTriangle, bg: "bg-accent-red/10", fg: "text-accent-red", labelColor: "text-accent-red" },
  compare: { icon: ArrowSeparateVertical, bg: "bg-ink-800", fg: "text-ink-300", labelColor: "text-ink-300" },
  approval: { icon: CheckCircle, bg: "bg-accent-amber/10", fg: "text-accent-amber", labelColor: "text-accent-amber" },
  git: { icon: GitBranch, bg: "bg-ink-800", fg: "text-ink-300", labelColor: "text-ink-300" },
  deploy: { icon: Rocket, bg: "bg-ink-800", fg: "text-ink-300", labelColor: "text-ink-300" },
  question: { icon: HelpCircle, bg: "bg-accent-amber/10", fg: "text-accent-amber", labelColor: "text-accent-amber" },
  done: { icon: Check, bg: "bg-ink-800", fg: "text-ink-300", labelColor: "text-ink-300" },
}

const STATE_COLORS: Record<string, string> = {
  RUNNING: "text-accent-blue",
  READY: "text-accent-amber",
  FAILED: "text-accent-red",
  BLOCKED: "text-accent-red",
  HELD: "text-muted-foreground",
}

const WORKTREE_STATE_DOT: Record<string, string> = {
  implementing: "bg-accent-blue",
  approval: "bg-accent-amber",
  failed: "bg-accent-red",
  blocked: "bg-accent-red",
  paused: "bg-muted-foreground",
  archived: "bg-muted-foreground/50",
}

function ToolApprovalCard({
  event,
  eventIndex,
  onApprove,
  onToolApprovalResponse,
}: {
  event: ApprovalEvent
  eventIndex: number
  onApprove: (eventIndex: number) => void
  onToolApprovalResponse?: (response: ToolApprovalResponse) => void
}) {
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null)
  const [responded, setResponded] = useState(false)

  // This is a tool approval (AI SDK) if it has approvalId and toolCallId
  const isToolApproval = !!(event.approvalId && event.toolCallId)

  const handleResponse = (approved: boolean) => {
    if (!isToolApproval || !event.approvalId || !event.toolCallId) return
    if (responded || submitting) return
    const action = approved ? "approve" : "deny"
    setSubmitting(action)
    // Call the callback with the response
    onToolApprovalResponse?.({
      approvalId: event.approvalId,
      toolCallId: event.toolCallId,
      approved,
      reason: note.trim() || undefined,
    })
    setResponded(true)
    setSubmitting(null)
  }

  // Already resolved
  if (event.resolved) {
    const isDenied = event.resolved.toLowerCase().includes("denied")
    return (
      <div className="mt-2">
        {event.approvalText && (
          <p className="mb-2 text-xs text-muted-foreground">{event.approvalText}</p>
        )}
        <div
          className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-[10px] font-medium ${
            isDenied
              ? "border-accent-red/30 bg-accent-red/5 text-accent-red"
              : "border-accent-green/30 bg-accent-green/5 text-accent-green"
          }`}
        >
          {isDenied ? <XmarkCircle className="size-3" /> : <Check className="size-3" />}
          {event.resolved}
        </div>
      </div>
    )
  }

  // Tool approval pending
  if (isToolApproval) {
    return (
      <div className="mt-2 space-y-2">
        {event.approvalText && (
          <p className="text-xs text-muted-foreground">{event.approvalText}</p>
        )}
        {event.toolName && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-600 dark:text-amber-400 w-fit">
            {event.toolName}
          </div>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note to the agent"
            maxLength={500}
            disabled={responded || submitting !== null}
            className="flex-1 min-w-32 rounded border border-border bg-background px-2 py-1 text-[10px] placeholder:text-muted-foreground/50 disabled:opacity-50"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => handleResponse(true)}
              disabled={responded || submitting !== null}
              className="rounded bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground hover:bg-brand-accent-hover disabled:opacity-50"
            >
              {submitting === "approve" ? "Approving..." : "Approve"}
            </button>
            <button
              onClick={() => handleResponse(false)}
              disabled={responded || submitting !== null}
              className="rounded border border-accent-red/30 bg-accent-red/5 px-2.5 py-1 text-[10px] font-medium text-accent-red hover:bg-accent-red/10 disabled:opacity-50"
            >
              {submitting === "deny" ? "Denying..." : "Deny"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Legacy approval (non-tool)
  return (
    <div className="mt-2">
      {event.approvalText && (
        <p className="mb-2 text-xs text-muted-foreground">{event.approvalText}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onApprove(eventIndex)}
          className="rounded bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground hover:bg-brand-accent-hover"
        >
          Approve merge
        </button>
      </div>
    </div>
  )
}

export function TimelineCard({ event, eventIndex, getWorktree, onApprove, onToolApprovalResponse }: Props) {
  const style = KIND_STYLES[event.kind] || KIND_STYLES.tool
  const inProgress = event.kind === "progress" && event.state === "running"
  const Icon = inProgress ? RefreshDouble : style.icon
  const isSubdued = event.kind === "tool" || event.kind === "delegate"
  const isUser = event.kind === "user"

  return (
    <div className={`${isUser ? "" : "rounded-xl border border-ink-800 bg-ink-900"} ${isSubdued ? "opacity-80" : ""}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 ${isUser ? "px-0 pb-1" : "border-b border-ink-800 px-4 py-3"}`}>
        <div className={`flex size-7 items-center justify-center rounded-full ${isUser ? "bg-ink-800" : style.bg}`}>
          <Icon className={`size-3.5 ${style.fg} ${inProgress ? "motion-safe:animate-spin" : ""}`} strokeWidth={1.8} />
        </div>
        <span className={`text-[13px] font-semibold ${isUser ? "text-ink-100" : style.labelColor}`}>
          {event.label}
        </span>
        <span className="text-xs text-ink-400">{event.time}</span>
      </div>

      {/* Body */}
      <div className={isUser ? "px-9 py-1" : "px-4 py-3"}>
        {event.body && (
          <MessageResponse className="text-sm leading-6">
            {event.body}
          </MessageResponse>
        )}

        {event.kind === "tool" && event.details ? (
          <details className="mt-2 text-[11px] text-ink-400">
            <summary className="hover:text-ink-200 cursor-pointer">
              Tool details
            </summary>
            <pre className="border-ink-800 bg-ink-950 mt-2 overflow-x-auto rounded border p-2 font-mono text-[10px] leading-5">
              {event.details}
            </pre>
          </details>
        ) : null}

        {/* Plan steps */}
        {event.kind === "plan" && (
          <div className="mt-3 overflow-hidden rounded-xl border border-ink-800 bg-ink-950">
            <div className="flex items-center gap-2 border-b border-ink-800 px-4 py-3">
              <span className="text-[15px] font-semibold">Execution Plan</span>
              <span className="text-xs text-muted-foreground">
                {(event as PlanEvent).steps.length} steps
              </span>
            </div>
            {(event as PlanEvent).steps.map((step) => (
              <div key={step.n} className="flex min-h-10 items-center gap-3 border-b border-ink-800 px-4 last:border-b-0">
                <span className="grid size-5 place-items-center rounded-full border border-muted-foreground/50 font-mono text-[10px] text-muted-foreground">{step.n}</span>
                <span className="flex-1 text-sm">{step.text}</span>
                <span className={`text-xs font-medium ${STATE_COLORS[step.state] || ""}`}>
                  {step.state}
                </span>
              </div>
            ))}
            {(event as PlanEvent).planApproved && (
              <div className="flex items-center gap-2 border-t border-ink-800 px-4 py-3">
                <span className="rounded border border-accent-green/30 bg-accent-green/5 px-2.5 py-1 text-[10px] font-medium text-accent-green">
                  Plan accepted
                </span>
              </div>
            )}
          </div>
        )}

        {/* Delegate chips */}
        {event.kind === "delegate" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(event as DelegateEvent).chips.map((chipId) => {
              const wt = getWorktree(chipId)
              return (
                <span
                  key={chipId}
                  className="flex items-center gap-1.5 rounded border border-ink-700 bg-ink-850 px-2 py-1 text-[10px] font-medium"
                >
                  <span className={`size-1.5 rounded-full ${WORKTREE_STATE_DOT[wt?.state || "archived"]}`} />
                  {chipId} {wt && `· ${wt.agent}`}
                </span>
              )
            })}
          </div>
        )}

        {/* Diff files */}
        {event.kind === "diff" && (
          <div className="mt-2 space-y-1">
            {(event as DiffEvent).files.map((file) => (
              <div key={file.path} className="flex items-center gap-2 font-mono text-[10px]">
                <span className="truncate text-muted-foreground">{file.path}</span>
                <span className="ml-auto text-accent-green">{file.add}</span>
                <span className="text-accent-red">{file.del}</span>
              </div>
            ))}
            {(event as DiffEvent).patch ? (
              <PatchViewer patch={(event as DiffEvent).patch} />
            ) : null}
          </div>
        )}

        {/* Fail log */}
        {event.kind === "fail" && (
          <div className="mt-2">
            <pre className="overflow-x-auto rounded bg-[var(--terminal-background)] p-2 font-mono text-[10px] leading-relaxed text-[var(--terminal-foreground)]">
              {(event as FailEvent).log}
            </pre>
          </div>
        )}

        {/* Compare columns */}
        {event.kind === "compare" && (
          <div className="mt-2 flex gap-3">
            {(event as CompareEvent).columns.map((colId) => {
              const wt = getWorktree(colId)
              if (!wt) return null
              return (
                <div key={colId} className="flex-1 rounded border border-ink-800 p-2">
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className={`size-1.5 rounded-full ${WORKTREE_STATE_DOT[wt.state]}`} />
                    <span className="font-mono text-[10px] font-medium">
                      {colId} · {wt.agent}
                    </span>
                  </div>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Files changed</span>
                      <span>{wt.files}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Checks</span>
                      <span className={wt.checks === "14/14" ? "text-accent-green" : "text-accent-amber"}>
                        {wt.checks}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Risk</span>
                      <span className="text-accent-amber">{wt.risk}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Approval */}
        {event.kind === "approval" && (
          <ToolApprovalCard
            event={event as ApprovalEvent}
            eventIndex={eventIndex}
            onApprove={onApprove}
            onToolApprovalResponse={onToolApprovalResponse}
          />
        )}
      </div>
    </div>
  )
}
