"use client"
import { useCallback, useEffect, useMemo, useRef } from "react"
import dynamic from "next/dynamic"
import { useIsMobile } from "@/hooks/use-mobile"
import { SessionBar } from "@/components/session-bar"
import { SplitContainer } from "@/components/split-container"
import { MobileWorkspaceShell } from "@/components/mobile/workspace-shell"
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider"

const TerminalHost = dynamic(
  () => import("@/components/terminal-host").then((m) => m.TerminalHost),
  { ssr: false },
)
import { useRegisterCommandActions } from "@/components/command-palette-provider"
import {
  getPreferredWorkspaceSession,
  useSessionsHydrated,
  useSessionsStore,
} from "@/hooks/use-sessions"
import { useSandboxPresence } from "@/hooks/use-sandbox-presence"
import {
  collectTerminalSessions,
  useSplitPanes,
  countPanes,
} from "@/hooks/use-split-panes"
import type { PaneType, SplitDir } from "@/hooks/use-split-panes"
import { useSandboxStore, useSandboxSync } from "@/hooks/use-sandbox"
import {
  isSandboxUiBooting,
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state"
import { useRepos } from "@/hooks/use-repos"
import type { Repo, SandboxRecord } from "@/lib/types"
import { trackActivation } from "@/lib/activation-tracking"
import {
  bindSessionToPendingSandboxBranch,
  ensureSessionSandboxBinding,
} from "@/lib/sandbox/session-retarget"
import { AsciiLoader } from "@/components/ascii-loader"
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider"
import {
  getSessionSandboxRestartCandidate,
  type SessionSandboxRestartCandidate,
} from "@/lib/sandbox/session-auto-restart"

type ActiveRepoProps = {
  id: string
  full_name: string
  root_directory?: string | null
  default_branch?: string
  working_branch: string | null
}

type ActiveSandboxProps = {
  id: string
}

function buildActiveRepoProps(
  activeRepo: Repo | null,
  activeSandbox: SandboxRecord | null,
): ActiveRepoProps | null {
  if (!activeRepo) {
    return null
  }

  return {
    id: activeRepo.id,
    full_name: activeRepo.full_name,
    root_directory: activeRepo.root_directory,
    default_branch: activeRepo.default_branch,
    working_branch: activeSandbox?.working_branch || null,
  }
}

function buildActiveSandboxProps(
  activeSandbox: SandboxRecord | null,
): ActiveSandboxProps | null {
  return activeSandbox ? { id: activeSandbox.id } : null
}

function resetAutoRestartedSandboxRef(
  autoRestartedRef: React.MutableRefObject<string | null>,
  activeSessionSandboxId: string | null,
) {
  if (
    autoRestartedRef.current
    && autoRestartedRef.current !== activeSessionSandboxId
  ) {
    autoRestartedRef.current = null
  }
}

async function restartSessionSandboxCandidate(
  candidate: SessionSandboxRestartCandidate,
  autoRestartedRef: React.MutableRefObject<string | null>,
  isCancelled: () => boolean,
) {
  const restartedSandbox = await useSandboxStore.getState().restart(
    candidate.repoId,
    {
      sandboxId: candidate.previousSandboxId,
    },
  )

  if (isCancelled()) return

  if (!restartedSandbox?.id) {
    if (autoRestartedRef.current === candidate.previousSandboxId) {
      autoRestartedRef.current = null
    }
    return
  }

  ensureSessionSandboxBinding(
    candidate.sessionId,
    candidate.previousSandboxId,
    restartedSandbox.id,
  )
}

function hasModifierKey(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey
}

function handleSplitShortcut(
  event: KeyboardEvent,
  activeId: string | null,
  split: (id: string, dir: SplitDir, type: PaneType) => void,
) {
  if (!hasModifierKey(event) || event.key !== "\\") {
    return false
  }

  event.preventDefault()
  if (activeId) {
    split(activeId, "horizontal", "agent")
  }
  return true
}

function isEditableShortcutTarget(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName
  return tag === "INPUT" || tag === "TEXTAREA"
}

function handleCloseShortcut(
  event: KeyboardEvent,
  activeId: string | null,
  paneCount: number,
  closePane: (id: string) => void,
) {
  if (!hasModifierKey(event) || event.key !== "w") {
    return false
  }

  if (isEditableShortcutTarget(event)) {
    return true
  }

  event.preventDefault()
  if (activeId && paneCount > 1) {
    closePane(activeId)
  }
  return true
}

function handleSessionSwitchShortcut(event: KeyboardEvent) {
  if (
    !hasModifierKey(event)
    || event.key < "1"
    || event.key > "9"
  ) {
    return false
  }

  const sessions = useSessionsStore.getState().sessions
  const index = parseInt(event.key, 10) - 1
  if (index >= sessions.length) {
    return true
  }

  event.preventDefault()
  useSessionsStore.getState().switchSession(sessions[index].id)
  return true
}

function WorkspaceShell() {
  const { mutate: mutateRepos } = useRepos()
  const isMobile = useIsMobile()

  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const sessions = useSessionsStore((s) => s.sessions)
  const activeSession = useSessionsStore((s) =>
    s.sessions.find((sess) => sess.id === s.activeSessionId)
  )
  const updatePaneTree = useSessionsStore((s) => s.updatePaneTree)

  const activeRepo = useSessionsStore((s) => {
    const session = s.sessions.find((sess) => sess.id === s.activeSessionId)
    return session?.activeRepo ?? null
  })
  const activeSessionSandboxId = activeSession?.activeSandboxId ?? null
  const activeSessionPendingBranch = activeSession?.pendingSandboxBranch ?? null
  const activeSandbox = useSandboxStore((s) =>
    activeRepo
      ? s.getSandboxForRepo(activeRepo.id, {
          sandboxId: activeSessionSandboxId,
          workingBranch: activeSessionPendingBranch,
        })
      : null
  )
  const activeSessionSandbox = useSandboxStore((s) =>
    activeSessionSandboxId ? s.getSandboxById(activeSessionSandboxId) : null
  )
  const sandboxCreating = useSandboxStore((s) =>
    activeRepo
      ? (() => {
          const scopedSandbox = s.getSandboxForRepo(activeRepo.id, {
            sandboxId: activeSessionSandboxId,
            workingBranch: activeSessionPendingBranch,
          })
          const scope = activeSessionSandboxId
            ? { sandboxId: activeSessionSandboxId }
            : activeSessionPendingBranch
              ? { workingBranch: activeSessionPendingBranch }
              : undefined
          // session: null is intentional — we only need the booting-vs-not
          // determination from the record, which does not depend on session.
          return Boolean(
            (scope ? s.isCreating(activeRepo.id, scope) : s.hasCreatingForRepo(activeRepo.id))
            || isSandboxUiBooting(resolveSandboxUiState({ session: null, record: scopedSandbox ?? null }))
            || (!scope && s.listSandboxesForRepo(activeRepo.id).some((sandbox) =>
              isSandboxUiBooting(resolveSandboxUiState({ session: null, record: sandbox }))
            ))
          )
        })()
      : false
  )
  const sandboxError = useSandboxStore((s) =>
    activeRepo
      ? s.getLaunchError(
          activeRepo.id,
          activeSessionSandboxId
            ? { sandboxId: activeSessionSandboxId }
            : activeSessionPendingBranch
              ? { workingBranch: activeSessionPendingBranch }
              : undefined,
        )
      : null
  )

  const {
    root,
    activeId,
    setActiveId,
    split,
    closePane,
    openFile,
    loadTree,
    updatePane,
    retargetFilePath,
    clearFilePath,
    updateTerminalSession,
    updateSplitSizes,
    popOutIDE,
    movePane,
  } = useSplitPanes()
  const terminalSessions = useMemo(() => collectTerminalSessions(root), [root])
  const sandboxPresenceEntries = useMemo(
    () =>
      sessions
        .filter((session) => Boolean(session.activeSandboxId))
        .map((session) => ({
          sandboxRecordId: session.activeSandboxId as string,
          sessionId: session.id,
        })),
    [sessions],
  )
  useSandboxPresence(sandboxPresenceEntries)

  // Load session's pane tree when switching sessions
  const prevSessionRef = useRef<string | null>(null)
  const justSwitchedRef = useRef(false)
  useEffect(() => {
    if (prevSessionRef.current !== activeSessionId) {
      prevSessionRef.current = activeSessionId
      justSwitchedRef.current = true
      const session = useSessionsStore.getState().getActiveSession()
      loadTree(session.paneTree, session.activeId)
    }
  }, [activeSessionId, loadTree])

  // Save pane tree changes back to session store (skip immediately after session switch)
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (justSwitchedRef.current) {
      justSwitchedRef.current = false
      return
    }
    clearTimeout(syncTimeoutRef.current)
    syncTimeoutRef.current = setTimeout(() => {
      updatePaneTree(root, activeId)
    }, 100)
    return () => clearTimeout(syncTimeoutRef.current)
  }, [root, activeId, updatePaneTree])

  const paneCount = countPanes(root)

  const handleOpenFile = useCallback((filePath: string, sandboxId?: string) => {
    openFile(filePath, { sandboxId })
  }, [openFile])

  const handleRetargetFilePath = useCallback((
    fromPath: string,
    toPath: string,
    sandboxId: string
  ) => {
    retargetFilePath(fromPath, toPath, {
      targetSandboxId: sandboxId,
      activeSessionSandboxId,
    })
  }, [activeSessionSandboxId, retargetFilePath])

  const handleClearFilePath = useCallback((
    targetPath: string,
    sandboxId: string
  ) => {
    clearFilePath(targetPath, {
      targetSandboxId: sandboxId,
      activeSessionSandboxId,
    })
  }, [activeSessionSandboxId, clearFilePath])

  // Keep sandbox state in sync with the server (detects stopped VMs, reaper actions, etc.)
  useSandboxSync()

  // Auto-restart stopped sandboxes when restoring a session that had one running
  const autoRestartedRef = useRef<string | null>(null)
  useEffect(() => {
    resetAutoRestartedSandboxRef(autoRestartedRef, activeSessionSandboxId)
    const candidate = getSessionSandboxRestartCandidate({
      activeRepoId: activeRepo?.id,
      activeSessionId,
      activeSessionSandbox,
      activeSessionSandboxId,
      autoRestartedSandboxId: autoRestartedRef.current,
      sandboxCreating,
    })
    if (!candidate) return

    let cancelled = false

    autoRestartedRef.current = candidate.previousSandboxId
    bindSessionToPendingSandboxBranch(
      candidate.sessionId,
      candidate.pendingSandboxBranch,
    )
    void restartSessionSandboxCandidate(
      candidate,
      autoRestartedRef,
      () => cancelled,
    )

    return () => {
      cancelled = true
    }
  }, [activeRepo?.id, activeSessionId, activeSessionSandbox, activeSessionSandboxId, sandboxCreating])

  // Sandbox state is hydrated by useSandboxSync(). Repos/agents via SWR hooks above.

  const openWorkspaceSession = useSessionsStore((s) => s.openWorkspaceSession)
  const stopSandbox = useSandboxStore((s) => s.stop)
  const { launchRepoSandbox } = useSandboxLaunchActions()

  const handleOpenChat = useCallback((repo: Repo) => {
    const sandbox = useSandboxStore.getState().getSandboxForRepo(repo.id)
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
        source: "command_palette",
        repo_id: repo.id,
        repo_full_name: repo.full_name,
        preview_state: shouldLaunchPreview
          ? "launch_requested"
          : "already_running",
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

    void (async () => {
      let workspaceSessionId: string | null = null
      const launchOutcome = await launchRepoSandbox(repo, {
        source: "command_palette",
        trigger: "open_workspace",
        intent: { kind: "start_fresh" },
        onConfirmed: (request) => {
          workspaceSessionId = openWorkspace({ pendingSandboxBranch: request.workingBranch })
        },
      })
      if (launchOutcome.status !== "launched") return
      ensureSessionSandboxBinding(
        workspaceSessionId,
        sandbox?.id ?? null,
        launchOutcome.sandbox.id
      )
    })()
  }, [launchRepoSandbox, openWorkspaceSession])

  const handleSyncRepos = useCallback(() => {
    trackActivation("repo_sync_started", { source: "command_palette" })
    fetch("/api/github/repos", {
      headers: getActiveTeamRequestHeaders(),
    })
      .then(async (r) => {
        if (!r.ok) {
          trackActivation("repo_sync_failed", { source: "command_palette", status_code: r.status })
          return
        }
        const repos = await r.json()
        trackActivation("repo_sync_completed", {
          source: "command_palette",
          repo_count: Array.isArray(repos) ? repos.length : 0,
        })
        void mutateRepos()
      })
      .catch(() => {
        trackActivation("repo_sync_failed", { source: "command_palette", status_code: "network_error" })
      })
  }, [mutateRepos])

  const handleStopSandbox = useCallback((repoId: string) => {
    const sb = useSandboxStore.getState().getSandboxForRepo(repoId)
    if (sb) void stopSandbox(sb.id)
  }, [stopSandbox])

  useRegisterCommandActions({
    onOpenChat: handleOpenChat,
    onStopSandbox: handleStopSandbox,
    onSyncRepos: handleSyncRepos,
  })

  // Keyboard shortcuts: Cmd+\ split, Cmd+W close pane, Cmd+1-9 switch session
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (handleSplitShortcut(e, activeId, split)) return
      if (handleCloseShortcut(e, activeId, paneCount, closePane)) return
      handleSessionSwitchShortcut(e)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [activeId, split, closePane, paneCount])

  const repoProps = buildActiveRepoProps(activeRepo, activeSandbox)
  const sandboxProps = buildActiveSandboxProps(activeSandbox)

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <SessionBar />
        <TerminalHost root={root} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <MobileWorkspaceShell
            root={root}
            activeId={activeId}
            onSelect={setActiveId}
            onSplit={(id: string, dir: SplitDir, type: PaneType, overrides) => split(id, dir, type, overrides)}
            onClose={closePane}
            onUpdatePane={updatePane}
            onUpdateTerminalSession={updateTerminalSession}
            terminalSessions={terminalSessions}
            activeRepo={repoProps}
            activeSandbox={sandboxProps}
            sandboxCreating={sandboxCreating}
            sandboxError={sandboxError}
            onOpenFile={handleOpenFile}
            onRetargetFilePath={handleRetargetFilePath}
            onClearFilePath={handleClearFilePath}
            onPopOutIDE={popOutIDE}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SessionBar />
      <TerminalHost root={root} />
      <div className="flex-1 min-h-0 overflow-hidden bg-border/20">
        <SplitContainer
          node={root}
          activeId={activeId}
          onSelect={setActiveId}
          onSplit={(id: string, dir: SplitDir, type: PaneType, overrides) => split(id, dir, type, overrides)}
          onClose={closePane}
          onUpdatePane={updatePane}
          onUpdateTerminalSession={updateTerminalSession}
          onUpdateSplitSizes={updateSplitSizes}
          terminalSessions={terminalSessions}
          onMovePane={movePane}
          activeRepo={repoProps}
          activeSandbox={sandboxProps}
          sandboxCreating={sandboxCreating}
          sandboxError={sandboxError}
          onOpenFile={handleOpenFile}
          onRetargetFilePath={handleRetargetFilePath}
          onClearFilePath={handleClearFilePath}
          onPopOutIDE={popOutIDE}
        />
      </div>
    </div>
  )
}

export default function WorkspacePage() {
  const sessions = useSessionsStore((state) => state.sessions)
  const activeSessionId = useSessionsStore((state) => state.activeSessionId)
  const switchSession = useSessionsStore((state) => state.switchSession)
  const sessionsHydrated = useSessionsHydrated()
  const preferredWorkspaceSession = useMemo(
    () => getPreferredWorkspaceSession(sessions, activeSessionId),
    [activeSessionId, sessions],
  )

  useEffect(() => {
    if (!sessionsHydrated) return

    if (preferredWorkspaceSession && preferredWorkspaceSession.id !== activeSessionId) {
      switchSession(preferredWorkspaceSession.id)
    }
  }, [activeSessionId, preferredWorkspaceSession, sessionsHydrated, switchSession])

  if (
    !sessionsHydrated
    || (preferredWorkspaceSession && preferredWorkspaceSession.id !== activeSessionId)
  ) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <AsciiLoader />
      </div>
    )
  }

  return <WorkspaceShell />
}
