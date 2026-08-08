"use client"

import { useState } from "react"
import { MessageResponse } from "@/components/ai-elements/message"
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
  onSelectWorktree: (id: string, tab?: string) => void
  onApprove: (eventIndex: number) => void
  onToolApprovalResponse?: (response: ToolApprovalResponse) => void
}

const KIND_STYLES: Record<string, { icon: typeof User; bg: string; fg: string; labelColor: string }> = {
  user: { icon: User, bg: "bg-secondary", fg: "text-muted-foreground", labelColor: "text-muted-foreground" },
  plan: { icon: Notes, bg: "bg-secondary", fg: "text-muted-foreground", labelColor: "text-muted-foreground" },
  delegate: { icon: Cpu, bg: "bg-secondary", fg: "text-muted-foreground", labelColor: "text-muted-foreground" },
  tool: { icon: Tools, bg: "bg-secondary", fg: "text-muted-foreground/70", labelColor: "text-muted-foreground/70" },
  diff: { icon: GitBranch, bg: "bg-secondary", fg: "text-muted-foreground", labelColor: "text-muted-foreground" },
  fail: { icon: XmarkCircle, bg: "bg-accent-red/10", fg: "text-accent-red", labelColor: "text-accent-red" },
  conflict: { icon: WarningTriangle, bg: "bg-accent-red/10", fg: "text-accent-red", labelColor: "text-accent-red" },
  compare: { icon: ArrowSeparateVertical, bg: "bg-secondary", fg: "text-muted-foreground", labelColor: "text-muted-foreground" },
  approval: { icon: CheckCircle, bg: "bg-accent-amber/10", fg: "text-accent-amber", labelColor: "text-accent-amber" },
  git: { icon: GitBranch, bg: "bg-secondary", fg: "text-muted-foreground", labelColor: "text-muted-foreground" },
  deploy: { icon: Rocket, bg: "bg-secondary", fg: "text-muted-foreground", labelColor: "text-muted-foreground" },
  question: { icon: HelpCircle, bg: "bg-accent-amber/10", fg: "text-accent-amber", labelColor: "text-accent-amber" },
  done: { icon: Check, bg: "bg-secondary", fg: "text-muted-foreground", labelColor: "text-muted-foreground" },
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
        <button className="rounded border border-accent-red/30 bg-accent-red/5 px-2.5 py-1 text-[10px] font-medium text-accent-red hover:bg-accent-red/10">
          Reject
        </button>
        <button className="rounded border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary">
          Ask a question
        </button>
      </div>
    </div>
  )
}

export function TimelineCard({ event, eventIndex, getWorktree, onSelectWorktree, onApprove, onToolApprovalResponse }: Props) {
  const style = KIND_STYLES[event.kind] || KIND_STYLES.tool
  const Icon = style.icon
  const isSubdued = event.kind === "tool" || event.kind === "delegate"

  return (
    <div className={`rounded-lg border border-border bg-card ${isSubdued ? "opacity-70" : ""}`}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className={`flex size-6 items-center justify-center rounded-full ${style.bg}`}>
          <Icon className={`size-3.5 ${style.fg}`} strokeWidth={1.8} />
        </div>
        <span className={`font-mono text-[10px] font-semibold uppercase tracking-wide ${style.labelColor}`}>
          {event.label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{event.time}</span>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5">
        {event.body && (
          <MessageResponse className="text-xs leading-relaxed">
            {event.body}
          </MessageResponse>
        )}

        {/* Plan steps */}
        {event.kind === "plan" && (
          <div className="mt-3 space-y-1.5">
            {(event as PlanEvent).steps.map((step) => (
              <div key={step.n} className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">{step.n}</span>
                <span className="flex-1 text-xs">{step.text}</span>
                <span className={`font-mono text-[9px] font-medium ${STATE_COLORS[step.state] || ""}`}>
                  {step.state}
                </span>
              </div>
            ))}
            {(event as PlanEvent).planApproved ? (
              <div className="mt-2 flex items-center gap-2">
                <button className="rounded border border-accent-green/30 bg-accent-green/5 px-2.5 py-1 text-[10px] font-medium text-accent-green">
                  Plan accepted
                </button>
                <button className="rounded border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-secondary">
                  Revise plan
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <button className="rounded bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground hover:bg-brand-accent-hover">
                  Approve plan
                </button>
                <button className="rounded border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-secondary">
                  Revise plan
                </button>
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
                <button
                  key={chipId}
                  onClick={() => onSelectWorktree(chipId)}
                  className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-[10px] font-medium hover:bg-secondary"
                >
                  <span className={`size-1.5 rounded-full ${WORKTREE_STATE_DOT[wt?.state || "archived"]}`} />
                  {chipId} {wt && `· ${wt.agent}`}
                </button>
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
            <div className="mt-2 flex items-center gap-2">
              <button className="rounded border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary">
                Open change set
              </button>
              <button className="rounded border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary">
                Compare
              </button>
            </div>
          </div>
        )}

        {/* Fail log */}
        {event.kind === "fail" && (
          <div className="mt-2">
            <pre className="overflow-x-auto rounded bg-[var(--terminal-background)] p-2 font-mono text-[10px] leading-relaxed text-[var(--terminal-foreground)]">
              {(event as FailEvent).log}
            </pre>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button className="flex items-center gap-1.5 rounded border border-accent-red/30 bg-accent-red/5 px-2 py-1 text-[10px] font-medium text-accent-red hover:bg-accent-red/10">
                <span className="size-1.5 rounded-full bg-accent-red" />
                Retry run
              </button>
              <button className="rounded border border-border px-2 py-1 text-[10px] font-medium hover:bg-secondary">
                Open terminal
              </button>
            </div>
          </div>
        )}

        {/* Conflict chips */}
        {event.kind === "conflict" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button className="flex items-center gap-1.5 rounded border border-accent-red/30 bg-accent-red/5 px-2 py-1 text-[10px] font-medium text-accent-red hover:bg-accent-red/10">
              <span className="size-1.5 rounded-full bg-accent-red" />
              Resolve conflict
            </button>
          </div>
        )}

        {/* Compare columns */}
        {event.kind === "compare" && (
          <div className="mt-2 flex gap-3">
            {(event as CompareEvent).columns.map((colId) => {
              const wt = getWorktree(colId)
              if (!wt) return null
              return (
                <div key={colId} className="flex-1 rounded border border-border p-2">
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
                  <button className="mt-2 w-full rounded border border-border py-1 text-[10px] font-medium hover:bg-secondary">
                    Choose this one
                  </button>
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
