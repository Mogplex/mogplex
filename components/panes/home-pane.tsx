"use client"

import { useCallback, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { scopedHref } from "@/lib/scoped-href"
import { useRepos } from "@/hooks/use-repos"
import { useSandboxStore } from "@/hooks/use-sandbox"
import { useSessionsStore } from "@/hooks/use-sessions"
import { useUser } from "@/hooks/use-user"
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider"
import { trackActivation } from "@/lib/activation-tracking"
import {
  presentGithubSetup,
  presentRepoSyncFailure,
} from "@/lib/activation/setup-state"
import { resolveSandboxRootDirectory } from "@/lib/repo-settings"
import { ensureSessionSandboxBinding } from "@/lib/sandbox/session-retarget"
import {
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state"
import type { Repo } from "@/lib/types"
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider"

function getRepoLoadErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : null
}

export function HomePane() {
  const router = useRouter()
  const { scope } = useParams<{ scope: string }>()
  const activeSession = useSessionsStore((state) => {
    return state.sessions.find((session) => session.id === state.activeSessionId) || state.sessions[0]
  })
  const openWorkspaceSession = useSessionsStore((state) => state.openWorkspaceSession)
  const activeRepo = activeSession?.activeRepo ?? null
  const activeSandbox = useSandboxStore((state) => {
    if (!activeRepo) return null
    return state.getSandboxForRepo(activeRepo.id, {
      sandboxId: activeSession?.activeSandboxId ?? null,
      workingBranch: activeSession?.pendingSandboxBranch ?? null,
    })
  })
  const sandboxUiState = resolveSandboxUiState({
    session: activeSession ?? null,
    record: activeSandbox,
  })
  const { user } = useUser()
  const { repos, error: reposError, mutate: mutateRepos } = useRepos()
  const { launchRepoSandbox } = useSandboxLaunchActions()
  const githubSetup = useMemo(() => presentGithubSetup(user), [user])
  const repoLoadErrorMessage = getRepoLoadErrorMessage(reposError)
  const [syncingRepos, setSyncingRepos] = useState(false)
  const [repoSyncError, setRepoSyncError] = useState<string | null>(null)

  const handleGithubPrimaryAction = useCallback(() => {
    if (!githubSetup.primaryAction) return

    trackActivation("github_connect_started", {
      source: "home_setup",
      connection_mode: githubSetup.primaryAction.kind === "connect" ? "oauth" : "app",
    })
    window.location.href = githubSetup.primaryAction.href
  }, [githubSetup.primaryAction])

  const handleSyncRepos = useCallback(async () => {
    setSyncingRepos(true)
    setRepoSyncError(null)
    trackActivation("repo_sync_started", { source: "home_setup" })

    try {
      const response = await fetch("/api/github/repos", {
        headers: getActiveTeamRequestHeaders(),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        trackActivation("repo_sync_failed", {
          source: "home_setup",
          status_code: response.status,
        })
        setRepoSyncError(
          presentRepoSyncFailure(
            payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
              ? payload.error
              : null,
            githubSetup.connectLabel,
          ),
        )
        return
      }

      const syncedRepos = Array.isArray(payload) ? payload : []
      await mutateRepos(syncedRepos, { revalidate: false })
      trackActivation("repo_sync_completed", {
        source: "home_setup",
        repo_count: syncedRepos.length,
      })
    } catch {
      trackActivation("repo_sync_failed", {
        source: "home_setup",
        status_code: "network_error",
      })
      setRepoSyncError(presentRepoSyncFailure(null, githubSetup.connectLabel))
    } finally {
      setSyncingRepos(false)
    }
  }, [githubSetup.connectLabel, mutateRepos])

  const handleOpenWorkspace = useCallback(async (repo: Repo) => {
    const sandbox = useSandboxStore.getState().getSandboxForRepo(repo.id)
    // Callback reads sandbox state fresh from the store on click and
    // intentionally passes session: null — the runtime-running check only
    // depends on the record, not the session that's about to be opened.
    const shouldLaunchPreview =
      !sandbox ||
      !isSandboxUiRuntimeRunning(
        resolveSandboxUiState({ session: null, record: sandbox })
      )
    const openWorkspace = (options?: {
      sandboxId?: string | null
      pendingSandboxBranch?: string | null
    }) => {
      trackActivation("workspace_opened", {
        source: "home_pane",
        repo_id: repo.id,
        repo_full_name: repo.full_name,
        preview_state: shouldLaunchPreview ? "launch_requested" : "already_running",
      })
      return openWorkspaceSession(repo, {
        sandboxId: options?.sandboxId ?? undefined,
        pendingSandboxBranch: options?.pendingSandboxBranch ?? undefined,
      })
    }

    if (!shouldLaunchPreview) {
      openWorkspace({ sandboxId: sandbox?.id })
      return
    }

    let workspaceSessionId: string | null = null
    const launchOutcome = await launchRepoSandbox(repo, {
      source: "home_pane",
      trigger: "open_workspace",
      intent: { kind: "start_fresh", interactive: false },
      onConfirmed: (request) => {
        workspaceSessionId = openWorkspace({ pendingSandboxBranch: request.workingBranch })
      },
    })

    if (launchOutcome.status !== "launched") return

    ensureSessionSandboxBinding(
      workspaceSessionId,
      activeSession?.activeSandboxId ?? null,
      launchOutcome.sandbox.id
    )
  }, [activeSession?.activeSandboxId, launchRepoSandbox, openWorkspaceSession])

  if (activeRepo) {
    // Prefer the running sandbox's launch-time path so the displayed
    // label reflects where the sandbox is actually operating, not the
    // repo's persistent default.
    const displayPath = resolveSandboxRootDirectory(activeSandbox, activeRepo)
    return (
      <div className="flex h-full overflow-y-auto p-6">
        <div className="m-auto w-full max-w-2xl rounded-lg border border-border bg-card/80 p-6 shadow-sm">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Workspace Guide</div>
          <h2 className="mt-2 text-xl font-medium text-foreground">
            This pane is for workspace guidance only.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Projects is where repository discovery and launch happens. Use this workspace for chat, preview, files, editor, and terminal once a repo is already open.
          </p>

          <div className="mt-5 rounded-lg border border-border bg-background/60 p-4 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">Current workspace</div>
            <div className="mt-2 font-mono text-xs text-foreground">{activeRepo.full_name}</div>
            {displayPath ? (
              <div className="mt-1 text-xs">Path: {displayPath}</div>
            ) : null}
            <div className="mt-1 text-xs">
              Preview: {isSandboxUiRuntimeRunning(sandboxUiState) ? "live" : activeSession?.pendingSandboxBranch ? "starting" : "not running"}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => router.push(scopedHref(scope, "/projects/repositories"))} className="h-8 rounded-sm text-xs">
              Open Projects
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
              className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Open Command Palette
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const hasRepos = repos.length > 0
  const nextActionLabel = hasRepos ? "Open a workspace" : "Sync spaces"
  const syncLabel = githubSetup.state === "app_install_pending" ? "Sync repos" : "Import spaces"
  const introTitle = hasRepos
    ? "Open Workspace is the main action."
    : githubSetup.primaryAction
      ? githubSetup.primaryAction.label
      : "Sync repos to get started."
  const introDetail = hasRepos
    ? "Synced repos are already available. Launch one into a workspace, then use preview, terminal, files, and chat together."
    : githubSetup.detail

  return (
    // overflow-y-auto + m-auto (not items-center): centering a child taller
    // than the pane overflows it off both edges with no way to scroll — with
    // a real repo list the grid is much taller than the pane.
    <div className="flex h-full overflow-y-auto p-6">
      <div className="m-auto w-full max-w-3xl rounded-lg border border-border bg-card/80 p-6 shadow-sm">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Activation</div>
        <h2 className="mt-2 text-xl font-medium text-foreground">{introTitle}</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{introDetail}</p>

        {repoLoadErrorMessage ? (
          <div className="mt-4 rounded-lg border border-border bg-background/60 p-4 text-sm">
            <div className="font-medium text-foreground">{repoLoadErrorMessage}</div>
          </div>
        ) : null}

        {repoSyncError ? (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-400">
            {repoSyncError}
          </div>
        ) : null}

        {hasRepos ? (
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {repos.map((repo) => (
              <button
                key={repo.id}
                type="button"
                data-testid={`home-open-workspace-${repo.id}`}
                onClick={() => void handleOpenWorkspace(repo)}
                className="rounded-lg border border-border bg-background/60 p-4 text-left transition-colors hover:bg-accent/40"
              >
                <div className="text-sm font-medium text-foreground">{repo.name || repo.full_name.split("/").pop() || repo.full_name}</div>
                {/* Sub-project spaces share full_name with their base repo;
                    without the path they render as identical duplicates. */}
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {repo.full_name}
                  {repo.root_directory ? `/${repo.root_directory}` : ""}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  Open Workspace
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {githubSetup.primaryAction ? (
              <Button
                type="button"
                size="sm"
                onClick={handleGithubPrimaryAction}
                className="h-8 rounded-sm text-xs"
              >
                {githubSetup.primaryAction.label}
              </Button>
            ) : null}
            {githubSetup.canSyncRepos ? (
              <Button
                type="button"
                size="sm"
                data-testid="home-sync-repos"
                onClick={() => void handleSyncRepos()}
                disabled={syncingRepos}
                className="h-8 rounded-sm text-xs"
              >
                {syncingRepos ? "Syncing..." : syncLabel}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => router.push(scopedHref(scope, "/projects/repositories"))}
              className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Open Projects
            </Button>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/50 p-4 text-xs text-muted-foreground">
          <div>First successful action: open a workspace.</div>
          <div>{`next: ${nextActionLabel}`}</div>
        </div>
      </div>
    </div>
  )
}
