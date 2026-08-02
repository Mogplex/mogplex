"use client"
import { useState, useRef, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { isWorkspaceSession, useSessionsStore } from "@/hooks/use-sessions"
import { scopedHref } from "@/lib/scoped-href"
import { useIsMobile } from "@/hooks/use-mobile"
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider"
import { TouchActions, type ActionItem } from "@/components/ui/touch-actions"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip"

const COLOR_MAP: Record<string, string> = {
  green: "bg-accent-green",
  blue: "bg-accent-blue",
  amber: "bg-amber-400",
  violet: "bg-accent-violet",
  cyan: "bg-cyan-400",
  rose: "bg-rose-400",
  orange: "bg-orange-400",
  teal: "bg-teal-400",
}

export function SessionBar() {
  const router = useRouter()
  const { scope } = useParams<{ scope: string }>()
  const isMobile = useIsMobile()
  const sessions = useSessionsStore((s) => s.sessions)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const switchSession = useSessionsStore((s) => s.switchSession)
  const closeSession = useSessionsStore((s) => s.closeSession)
  const renameSession = useSessionsStore((s) => s.renameSession)
  const resetSessionLayout = useSessionsStore((s) => s.resetSessionLayout)
  const { launchRepoSandbox } = useSandboxLaunchActions()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const visibleSessions = sessions.filter((session) => isWorkspaceSession(session))
  const renderedSessions = visibleSessions.length > 0 ? visibleSessions : sessions

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      renameSession(editingId, editValue.trim())
    }
    setEditingId(null)
  }

  return (
    <div className="flex h-9 items-center gap-1 border-b border-border bg-background px-1">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pr-1">
        {renderedSessions.map((session) => {
          const isActive = session.id === activeSessionId
          const colorClass = COLOR_MAP[session.color] || "bg-accent-green"

          const sessionRepo = isWorkspaceSession(session) ? session.activeRepo : null
          const actions: ActionItem[] = [
            { type: "item", label: "Rename", onSelect: () => { setEditingId(session.id); setEditValue(session.name) } },
            { type: "item", label: "Reset Layout", onSelect: () => resetSessionLayout(session.id) },
            ...(sessionRepo
              ? [
                  { type: "separator" as const },
                  {
                    type: "item" as const,
                    label: "Start fresh sandbox…",
                    onSelect: () => {
                      void launchRepoSandbox(sessionRepo, {
                        source: "session_overflow",
                        trigger: "user_action",
                        intent: { kind: "start_fresh" },
                      })
                    },
                  },
                ]
              : []),
            ...(renderedSessions.length > 1
              ? [
                  { type: "separator" as const },
                  { type: "item" as const, label: "Close", onSelect: () => closeSession(session.id), destructive: true },
                ]
              : []),
          ]

          return (
            <TouchActions key={session.id} actions={actions} title={session.name}>
              <div
                data-testid={`session-tab-${session.index}`}
                onClick={() => switchSession(session.id)}
                onDoubleClick={() => {
                  setEditingId(session.id)
                  setEditValue(session.name)
                }}
                className={`group flex h-7 shrink-0 items-center gap-1.5 rounded-t-md px-2.5 font-mono text-[11px] transition-colors ${
                  isActive
                    ? "z-10 -mb-px border border-border border-b-card bg-card text-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colorClass}`} />
                {editingId === session.id ? (
                  <input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename()
                      if (e.key === "Escape") setEditingId(null)
                    }}
                    className="w-16 border-none bg-transparent text-[11px] font-mono outline-none"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={isMobile ? "max-w-[18ch] truncate" : undefined}>
                    {session.index}:{session.name}
                  </span>
                )}
                {renderedSessions.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      closeSession(session.id)
                    }}
                    className={`flex h-4 w-4 items-center justify-center text-xs text-muted-foreground transition-opacity hover:text-foreground ${
                      isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    x
                  </button>
                )}
              </div>
            </TouchActions>
          )
        })}
      </div>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => router.push(scopedHref(scope, "/projects/repositories"))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            >
              +
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[200px] text-[10px]">
            Open another workspace from Projects. Existing sessions stay available here.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
