"use client"
import { useState, useEffect } from "react"
import { useParams, usePathname } from "next/navigation"
import useSWR from "swr"
import { scopedHref } from "@/lib/scoped-href"
import { useSandboxStore } from "@/hooks/use-sandbox"
import {
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state"
import { useUser } from "@/hooks/use-user"
import { useIsMobile } from "@/hooks/use-mobile"
import { useSessionsStore } from "@/hooks/use-sessions"
import { countPanes } from "@/hooks/use-split-panes"
import type { Repo } from "@/lib/types"
import { fetchJsonArray } from "@/lib/client-fetch"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet"

const fetcher = (url: string) => fetchJsonArray<Repo>(url, "Failed to load repos")

function Separator() {
  return <div className="h-3 w-px shrink-0 bg-border" />
}

export function StatusBar() {
  const [datetime, setDatetime] = useState("")
  const isMobile = useIsMobile()
  const pathname = usePathname() || ""
  const { scope } = useParams<{ scope: string }>()
  const isWorkspaceRoute = scope
    ? pathname.startsWith(scopedHref(scope, "/projects/workspace"))
    : false

  const { data: repos } = useSWR<Repo[]>("/api/repos", fetcher)
  const sandboxesById = useSandboxStore((state) => state.sandboxesById)
  const { user } = useUser()
  const githubPrimaryAction = user?.github_primary_action
    || (!user?.github_connected
      ? {
          label: user?.github_app_available ? "Install GitHub App" : "Connect GitHub",
        }
      : null)

  const activeSession = useSessionsStore((s) =>
    s.sessions.find((sess) => sess.id === s.activeSessionId)
  )

  const sessionName = isWorkspaceRoute ? activeSession?.name : undefined
  const activeRepo = isWorkspaceRoute ? activeSession?.activeRepo ?? null : null
  const paneCount =
    isWorkspaceRoute && activeSession?.paneTree
      ? countPanes(activeSession.paneTree)
      : null

  const resolvedRepoCount = repos?.length ?? 0
  const resolvedSandboxCount = Object.values(sandboxesById).filter((sandbox) =>
    isSandboxUiRuntimeRunning(
      resolveSandboxUiState({ session: null, record: sandbox })
    )
  ).length

  useEffect(() => {
    const update = () => {
      setDatetime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  const nextStep =
    resolvedRepoCount === 0
      ? (
          githubPrimaryAction
            ? githubPrimaryAction.label
            : "Sync spaces"
        )
      : !activeRepo
        ? "Open a workspace"
        : resolvedSandboxCount === 0
          ? "Start preview"
          : "Ask the agent for a task"

  if (isMobile) {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <div className="flex min-h-8 items-center justify-between border-t border-border bg-card px-3 pb-[env(safe-area-inset-bottom)] text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="text-accent-green">●</span>
              <span className="truncate">{activeRepo?.full_name || nextStep}</span>
            </div>
            <span className="shrink-0 text-secondary-foreground">{datetime}</span>
          </div>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[50vh]">
          <SheetTitle className="text-sm">Status</SheetTitle>
          <div className="flex flex-col gap-3 pt-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="text-accent-green">●</span>
              <span>mogplex v0.1.0</span>
            </div>
            {sessionName && (
              <div>Session: <span className="font-mono text-secondary-foreground">{sessionName}</span></div>
            )}
            {activeRepo && (
              <div>Repo: <span className="font-mono text-foreground">{activeRepo.full_name}</span></div>
            )}
            {paneCount != null && (
              <div>Panes: <span className="text-secondary-foreground">{paneCount}</span></div>
            )}
            <div>Repos: <span className="text-secondary-foreground">{resolvedRepoCount}</span></div>
            <div>Previews: <span className="text-secondary-foreground">{resolvedSandboxCount} live</span></div>
            <div>Upcoming: <span className="text-secondary-foreground">{nextStep}</span></div>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div className="flex h-10 items-center gap-4 overflow-x-auto border-t border-border bg-card px-3 text-[12px] text-muted-foreground whitespace-nowrap">
      <div className="flex shrink-0 items-center gap-[5px]">
        <span className="text-accent-green">●</span>
        <span>mogplex v0.1.0</span>
      </div>
      {sessionName && (
        <>
          <Separator />
          <span className="shrink-0">session: <span className="font-mono text-secondary-foreground">{sessionName}</span></span>
        </>
      )}
      {activeRepo && (
        <>
          <Separator />
          <span className="shrink-0">repo: <span className="font-mono text-foreground">{activeRepo.full_name}</span></span>
        </>
      )}
      {paneCount != null && (
        <>
          <Separator />
          <span className="shrink-0">panes: <span className="text-secondary-foreground">{paneCount}</span></span>
        </>
      )}
      <Separator />
      <span className="shrink-0">repos: <span className="text-secondary-foreground">{resolvedRepoCount}</span></span>
      <Separator />
      <span className="shrink-0">previews: <span className="text-secondary-foreground">{resolvedSandboxCount} live</span></span>
      <div className="ml-auto flex shrink-0 items-center gap-4 pl-4">
        <span className="shrink-0 text-secondary-foreground">{datetime}</span>
      </div>
    </div>
  )
}
