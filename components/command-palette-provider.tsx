"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useParams, useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { CommandPalette } from "@/components/command-palette"
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider"
import { scopedHref } from "@/lib/scoped-href"
import { useRepos } from "@/hooks/use-repos"
import { useAgents } from "@/hooks/use-agents"
import { useSessionsStore } from "@/hooks/use-sessions"
import { useSandboxStore } from "@/hooks/use-sandbox"
import { trackActivation } from "@/lib/activation-tracking"
import type { Repo } from "@/lib/types"

type PaletteActions = {
  onOpenChat?: (repo: Repo) => void
  onStopSandbox?: (repoId: string) => void
  onAssignAgent?: (repo: Repo) => void
  onSyncRepos?: () => void
}

type CommandPaletteContextValue = {
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: boolean
}

type CommandPaletteActionsContextValue = {
  register: (actions: PaletteActions) => () => void
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)
const CommandPaletteActionsContext =
  createContext<CommandPaletteActionsContextValue | null>(null)

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { scope } = useParams<{ scope: string }>()
  const { theme, setTheme } = useTheme()
  const { repos, mutate: mutateRepos } = useRepos()
  const { agents } = useAgents()

  const [isOpen, setIsOpen] = useState(false)
  const [paletteKey, setPaletteKey] = useState(0)
  const actionsRef = useRef<PaletteActions>({})

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => {
    setIsOpen(false)
    setPaletteKey((k) => k + 1)
  }, [])
  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (prev) setPaletteKey((k) => k + 1)
      return !prev
    })
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [toggle])

  const register = useCallback((actions: PaletteActions) => {
    actionsRef.current = { ...actionsRef.current, ...actions }
    return () => {
      const next = { ...actionsRef.current }
      for (const key of Object.keys(actions) as Array<keyof PaletteActions>) {
        if (next[key] === actions[key]) delete next[key]
      }
      actionsRef.current = next
    }
  }, [])

  const handleOpenChat = useCallback(
    (repo: Repo) => {
      const registered = actionsRef.current.onOpenChat
      if (registered) {
        registered(repo)
        return
      }
      trackActivation("workspace_opened", {
        source: "command_palette",
        repo_id: repo.id,
        repo_full_name: repo.full_name,
        preview_state: "deferred",
      })
      useSessionsStore.getState().openWorkspaceSession(repo)
      router.push(scopedHref(scope, "/projects/workspace"))
    },
    [router, scope],
  )

  const handleStopSandbox = useCallback((repoId: string) => {
    const registered = actionsRef.current.onStopSandbox
    if (registered) {
      registered(repoId)
      return
    }
    const sb = useSandboxStore.getState().getSandboxForRepo(repoId)
    if (sb) void useSandboxStore.getState().stop(sb.id)
  }, [])

  const handleAssignAgent = useCallback(
    (repo: Repo) => {
      const registered = actionsRef.current.onAssignAgent
      if (registered) {
        registered(repo)
        return
      }
      useSessionsStore.getState().openWorkspaceSession(repo)
      router.push(scopedHref(scope, "/projects/workspace"))
    },
    [router, scope],
  )

  const handleSyncRepos = useCallback(() => {
    const registered = actionsRef.current.onSyncRepos
    if (registered) {
      registered()
      return
    }
    trackActivation("repo_sync_started", { source: "command_palette" })
    fetch("/api/github/repos", {
      headers: getActiveTeamRequestHeaders(),
    })
      .then(async (r) => {
        if (!r.ok) {
          trackActivation("repo_sync_failed", {
            source: "command_palette",
            status_code: r.status,
          })
          return
        }
        const list = await r.json()
        trackActivation("repo_sync_completed", {
          source: "command_palette",
          repo_count: Array.isArray(list) ? list.length : 0,
        })
        void mutateRepos()
      })
      .catch(() => {
        trackActivation("repo_sync_failed", {
          source: "command_palette",
          status_code: "network_error",
        })
      })
  }, [mutateRepos])

  const handleToggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark")
  }, [theme, setTheme])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setIsOpen(true)
        return
      }
      close()
    },
    [close],
  )

  const value = useMemo<CommandPaletteContextValue>(
    () => ({ open, close, toggle, isOpen }),
    [open, close, toggle, isOpen],
  )

  const actionsValue = useMemo<CommandPaletteActionsContextValue>(
    () => ({ register }),
    [register],
  )

  return (
    <CommandPaletteContext.Provider value={value}>
      <CommandPaletteActionsContext.Provider value={actionsValue}>
        {children}
        <CommandPalette
          key={paletteKey}
          open={isOpen}
          onOpenChange={handleOpenChange}
          repos={repos}
          agents={agents}
          onOpenChat={handleOpenChat}
          onStopSandbox={handleStopSandbox}
          onAssignAgent={handleAssignAgent}
          onSyncRepos={handleSyncRepos}
          onToggleTheme={handleToggleTheme}
        />
      </CommandPaletteActionsContext.Provider>
    </CommandPaletteContext.Provider>
  )
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext)
  if (!ctx) {
    throw new Error("useCommandPalette must be used inside CommandPaletteProvider")
  }
  return ctx
}

export function useRegisterCommandActions(actions: PaletteActions) {
  const ctx = useContext(CommandPaletteActionsContext)
  const actionsRef = useRef(actions)
  const suppliedKeysRef = useRef<ReadonlyArray<keyof PaletteActions>>(
    (Object.keys(actions) as Array<keyof PaletteActions>).filter(
      (key) => actions[key] != null,
    ),
  )

  useEffect(() => {
    actionsRef.current = actions
  })

  useEffect(() => {
    if (!ctx) return
    const stable: PaletteActions = {}
    for (const key of suppliedKeysRef.current) {
      const wrapper = (...args: unknown[]) => {
        const fn = actionsRef.current[key] as
          | ((...fnArgs: unknown[]) => unknown)
          | undefined
        return fn?.(...args)
      }
      ;(stable as Record<keyof PaletteActions, unknown>)[key] = wrapper
    }
    return ctx.register(stable)
  }, [ctx])
}
