"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { scopedHref } from "@/lib/scoped-href"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useRepos } from "@/hooks/use-repos"
import { useSandboxStore, useSandboxSync } from "@/hooks/use-sandbox"
import { useSessionsStore } from "@/hooks/use-sessions"
import { resolveSandboxRootDirectory } from "@/lib/repo-settings"
import { buildSandboxObservabilityHref } from "@/lib/sandbox/navigation"
import {
  getSandboxUiRuntimeStatus,
  isSandboxUiBooting,
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state"
import type { SandboxRecord } from "@/lib/types"

type StatusFilter = "active" | "all"

function formatTimestamp(value?: string | null) {
  if (!value) return "Unknown"
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function rankRuntimeStatus(value: string | null) {
  switch (value) {
    case "running":
      return 0
    case "installing":
      return 1
    case "creating":
      return 2
    case "error":
      return 3
    default:
      return 4
  }
}

// Compare on a precomputed runtimeStatus so Array.sort does not re-run the
// resolver pipeline 2× per comparison (O(n log n) total) on large sandbox sets.
type RankedSandbox = { sandbox: SandboxRecord; runtimeStatus: string | null }

function compareRankedSandboxes(a: RankedSandbox, b: RankedSandbox) {
  const statusOrder =
    rankRuntimeStatus(a.runtimeStatus) - rankRuntimeStatus(b.runtimeStatus)
  if (statusOrder !== 0) return statusOrder

  return (
    new Date(b.sandbox.created_at).getTime() -
    new Date(a.sandbox.created_at).getTime()
  )
}

export default function SandboxManagementPage() {
  const router = useRouter()
  const { scope } = useParams<{ scope: string }>()
  const { repos } = useRepos()
  const refresh = useSandboxStore((state) => state.refresh)
  const stopSandbox = useSandboxStore((state) => state.stop)
  const deleteSandbox = useSandboxStore((state) => state.deleteRecord)
  const sandboxesById = useSandboxStore((state) => state.sandboxesById)
  const openWorkspaceSession = useSessionsStore((state) => state.openWorkspaceSession)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active")
  const [search, setSearch] = useState("")
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useSandboxSync()

  useEffect(() => {
    void refresh()
  }, [refresh])

  const repoMap = useMemo(() => {
    return new Map(repos.map((repo) => [repo.id, repo]))
  }, [repos])

  const filteredSandboxes = useMemo(() => {
    const query = search.trim().toLowerCase()
    return Object.values(sandboxesById)
      .map((sandbox) => ({
        sandbox,
        runtimeStatus: getSandboxUiRuntimeStatus(
          resolveSandboxUiState({ session: null, record: sandbox })
        ),
      }))
      .filter(({ sandbox, runtimeStatus }) => {
        if (
          statusFilter === "active" &&
          !["running", "creating", "installing"].includes(runtimeStatus ?? "")
        ) {
          return false
        }

        if (!query) return true

        const repo = repoMap.get(sandbox.repo_id)
        const haystack = [
          repo?.full_name,
          sandbox.working_branch,
          sandbox.base_branch,
          runtimeStatus,
          sandbox.runtime_summary.preview_url,
          // Allow filtering monorepo sandboxes by their workspace path
          // so users can find e.g. all `apps/web` sandboxes at once.
          // null = explicit repo-root sandbox; .filter(Boolean) below
          // drops it from the haystack (correct: there's nothing to
          // type-match against for an explicit-repo-root row).
          resolveSandboxRootDirectory(sandbox, repo),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()

        return haystack.includes(query)
      })
      .sort(compareRankedSandboxes)
      .map(({ sandbox }) => sandbox)
  }, [repoMap, sandboxesById, search, statusFilter])

  const handleOpenWorkspace = useCallback((sandbox: SandboxRecord) => {
    const repo = repoMap.get(sandbox.repo_id)
    if (!repo) return

    openWorkspaceSession(repo, {
      sandboxId: sandbox.id,
      previewTab: "preview",
      focusPaneType: "preview",
    })
    router.push(scopedHref(scope, "/projects/workspace"))
  }, [openWorkspaceSession, repoMap, router, scope])

  const handleStopSandbox = useCallback(async (sandbox: SandboxRecord) => {
    setStoppingId(sandbox.id)
    try {
      await stopSandbox(sandbox.id)
    } finally {
      setStoppingId(null)
    }
  }, [stopSandbox])

  const handleOpenHealth = useCallback((sandbox: SandboxRecord) => {
    const repo = repoMap.get(sandbox.repo_id)
    if (!repo) return

    openWorkspaceSession(repo, {
      sandboxId: sandbox.id,
      previewTab: "health",
      focusPaneType: "preview",
    })
    router.push(scopedHref(scope, "/projects/workspace"))
  }, [openWorkspaceSession, repoMap, router, scope])

  const handleDeleteSandbox = useCallback(async (sandbox: SandboxRecord) => {
    const repo = repoMap.get(sandbox.repo_id)
    const path = resolveSandboxRootDirectory(sandbox, repo)
    const sandboxLabel = path
      ? `${sandbox.working_branch} (${path})`
      : sandbox.working_branch
    const confirmed = window.confirm(
      `Delete sandbox ${sandboxLabel} for ${repo?.full_name || sandbox.repo_id}? This removes the sandbox record and best-effort tears down the remote sandbox.`,
    )
    if (!confirmed) return

    setDeletingId(sandbox.id)
    try {
      await deleteSandbox(sandbox.id)
    } finally {
      setDeletingId(null)
    }
  }, [deleteSandbox, repoMap])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-sm font-medium text-foreground/85">Sandboxes</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Manual override for running and pending sandboxes. Open a workspace pinned to a specific sandbox or stop it directly.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search repo, branch, or status..."
              className="h-8 w-64 rounded-sm border-border bg-card/80 text-xs text-foreground placeholder:text-muted-foreground shadow-none"
            />
            <div className="flex items-center rounded-sm border border-border bg-card/60">
              <button
                onClick={() => setStatusFilter("active")}
                className={`px-2.5 py-1.5 text-xs transition-colors ${
                  statusFilter === "active"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Live + pending
              </button>
              <button
                onClick={() => setStatusFilter("all")}
                className={`px-2.5 py-1.5 text-xs transition-colors ${
                  statusFilter === "all"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
              className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Refresh
            </Button>
            <Button asChild variant="ghost" size="sm" className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              <Link href={scopedHref(scope, "/projects/repositories")}>Back to repositories</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">
        {filteredSandboxes.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/70 px-4 py-8 text-center text-sm text-muted-foreground">
            No sandboxes match the current filters.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSandboxes.map((sandbox) => {
              const repo = repoMap.get(sandbox.repo_id)
              const uiState = resolveSandboxUiState({
                session: null,
                record: sandbox,
              })
              const runtimeStatus = getSandboxUiRuntimeStatus(uiState)
              const previewUrl = sandbox.runtime_summary.preview_url
              const canStop = ["running", "creating", "installing"].includes(runtimeStatus ?? "")
              const observabilityHref = buildSandboxObservabilityHref({
                scope,
                repoId: sandbox.repo_id,
                sandboxRecordId: sandbox.id,
              })
              // Show the workspace path as a peer of branch only when the
              // sandbox is actually running at a subdirectory. Hide for
              // explicit-repo-root (null) sandboxes — the visual default
              // is already "no path" so we don't want every row claiming
              // ":/". The repo card header still shows the repo's
              // persistent default when one exists.
              const sandboxPath = resolveSandboxRootDirectory(sandbox, repo)
              const statusTone = isSandboxUiRuntimeRunning(uiState)
                ? "border-accent-green/20 bg-accent-green/[0.06] text-accent-green"
                : isSandboxUiBooting(uiState)
                  ? "border-amber-400/20 bg-amber-400/[0.06] text-amber-300"
                  : uiState.kind === "errored"
                    ? "border-red-500/20 bg-red-500/[0.06] text-red-400"
                    : "border-border bg-accent/70 text-muted-foreground"

              return (
                <div key={sandbox.id} className="rounded-lg border border-border bg-card/70 p-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-foreground">
                          {repo?.full_name || sandbox.repo_id}
                        </div>
                        <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] ${statusTone}`}>
                          <span className={`size-1.5 rounded-full ${isSandboxUiRuntimeRunning(uiState) ? "bg-accent-green" : isSandboxUiBooting(uiState) ? "bg-amber-300" : uiState.kind === "errored" ? "bg-red-400" : "bg-muted-foreground"}`} />
                          {runtimeStatus}
                        </span>
                        <span className="inline-flex items-center rounded-sm border border-border bg-accent/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {sandbox.working_branch}
                        </span>
                        {sandbox.base_branch !== sandbox.working_branch && (
                          <span className="inline-flex items-center rounded-sm border border-border bg-accent/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                            base {sandbox.base_branch}
                          </span>
                        )}
                        {sandboxPath && (
                          <span
                            className="inline-flex items-center rounded-sm border border-border bg-accent/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                            title={`Workspace path: ${sandboxPath}`}
                          >
                            {sandboxPath}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        <span>Created {formatTimestamp(sandbox.created_at)}</span>
                        <span>Last active {formatTimestamp(sandbox.last_active_at)}</span>
                        {sandbox.billing_summary.project_id && <span>Billing {sandbox.billing_summary.project_id}</span>}
                        <span>Sandbox {sandbox.sandbox_id}</span>
                      </div>

                      {previewUrl ? (
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-xs text-primary hover:underline"
                        >
                          {previewUrl}
                        </a>
                      ) : (
                        <div className="text-xs text-muted-foreground">No preview URL yet</div>
                      )}

                      {sandbox.error_summary.current_error && (
                        <div className="rounded-md border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-[11px] text-red-400">
                          {sandbox.error_summary.current_error}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleOpenWorkspace(sandbox)}
                        className="h-8 rounded-sm text-xs"
                      >
                        Open Workspace
                      </Button>
                      {previewUrl ? (
                        <Button asChild variant="ghost" size="sm" className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                          <a href={previewUrl} target="_blank" rel="noopener noreferrer">Open preview</a>
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenHealth(sandbox)}
                        className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        Open health
                      </Button>
                      <Button asChild variant="ghost" size="sm" className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                        <Link href={observabilityHref}>Observability</Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleStopSandbox(sandbox)}
                        disabled={!canStop || stoppingId === sandbox.id}
                        className="h-8 rounded-sm text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:text-muted-foreground"
                      >
                        {stoppingId === sandbox.id ? "Stopping..." : "Stop sandbox"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDeleteSandbox(sandbox)}
                        disabled={deletingId === sandbox.id}
                        className="h-8 rounded-sm text-xs text-red-500 hover:bg-red-500/10 hover:text-red-300 disabled:text-muted-foreground"
                      >
                        {deletingId === sandbox.id ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
