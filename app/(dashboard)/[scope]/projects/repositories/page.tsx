"use client"
import { useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { RepoDashboard } from "@/components/repo-dashboard"
import { scopedHref } from "@/lib/scoped-href"
import { useSandboxStore } from "@/hooks/use-sandbox"
import { useSessionsStore } from "@/hooks/use-sessions"
import { ensureSessionSandboxBinding } from "@/lib/sandbox/session-retarget"
import {
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state"
import type { Repo } from "@/lib/types"
import { trackActivation } from "@/lib/activation-tracking"
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider"

export default function RepositoriesPage() {
  const router = useRouter()
  const { scope } = useParams<{ scope: string }>()
  const openWorkspaceSession = useSessionsStore((s) => s.openWorkspaceSession)
  const { launchRepoSandbox } = useSandboxLaunchActions()

  const handleOpenChat = useCallback((repo: Repo) => {
    // Auto-launch sandbox if not running (use getState for fresh data in callback)
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
        source: "spaces_page",
        repo_id: repo.id,
        repo_full_name: repo.full_name,
        preview_state: shouldLaunchPreview
          ? "launch_requested"
          : "already_running",
      })
      const sessionId = openWorkspaceSession(repo, {
        sandboxId: options?.sandboxId ?? undefined,
        pendingSandboxBranch: options?.pendingSandboxBranch ?? undefined,
      })
      router.push(scopedHref(scope, "/projects/workspace"))
      return sessionId
    }

    if (!shouldLaunchPreview) {
      openWorkspace({ sandboxId: sandbox?.id })
      return
    }

    void (async () => {
      let workspaceSessionId: string | null = null
      const launchOutcome = await launchRepoSandbox(repo, {
        source: "spaces_page",
        trigger: "open_workspace",
        intent: { kind: "start_fresh", interactive: false },
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
  }, [launchRepoSandbox, openWorkspaceSession, router, scope])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <RepoDashboard onOpenChat={handleOpenChat} />
    </div>
  )
}
