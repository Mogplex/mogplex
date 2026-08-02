"use client"

import { useState, useCallback, useMemo } from "react"
import type {
  PaneNode,
  PaneType,
  SplitDir,
  TerminalSessionSummary,
  TreeNode,
} from "@/hooks/use-split-panes"
import type { SandboxError } from "@/lib/sandbox/error-state"
import type { Repo } from "@/lib/types"
import { PaneContent } from "@/components/pane-content"
import { cn } from "@/lib/utils"
import { DndContext } from "@dnd-kit/core"

type MobileTab = "agent" | "preview" | "files" | "terminal"

const TABS: { id: MobileTab; label: string; icon: string; paneType: PaneType }[] = [
  { id: "agent", label: "Chat", icon: "◈", paneType: "agent" },
  { id: "preview", label: "Preview", icon: "◫", paneType: "preview" },
  { id: "files", label: "Files", icon: "▤", paneType: "files" },
  { id: "terminal", label: "Terminal", icon: "▸", paneType: "terminal" },
]

function findPaneByType(node: TreeNode, type: PaneType): PaneNode | null {
  if ("type" in node) {
    return node.type === type ? node : null
  }
  for (const child of node.children) {
    const found = findPaneByType(child, type)
    if (found) return found
  }
  return null
}

function findFirstPane(node: TreeNode): PaneNode | null {
  if ("type" in node) return node
  for (const child of node.children) {
    const found = findFirstPane(child)
    if (found) return found
  }
  return null
}

interface Props {
  root: TreeNode
  activeId: string
  onSelect: (id: string) => void
  onSplit: (id: string, dir: SplitDir, type: PaneType, overrides?: Partial<PaneNode>) => void
  onClose: (id: string) => void
  onUpdatePane?: (id: string, updates: Partial<PaneNode>) => void
  onUpdateTerminalSession?: (
    terminalSessionKey: string,
    updates: Partial<PaneNode>
  ) => void
  terminalSessions?: TerminalSessionSummary[]
  activeRepo?: (
    Pick<Repo, "id" | "full_name" | "root_directory" | "default_branch">
    & { working_branch?: string | null }
  ) | null
  activeSandbox?: { id: string } | null
  sandboxCreating?: boolean
  sandboxError?: SandboxError | null
  onOpenFile?: (filePath: string, sandboxId?: string) => void
  onRetargetFilePath?: (
    fromPath: string,
    toPath: string,
    sandboxId: string
  ) => void
  onClearFilePath?: (targetPath: string, sandboxId: string) => void
  onPopOutIDE?: (paneId: string, filePath?: string) => void
}

export function MobileWorkspaceShell({
  root,
  activeId: _activeId,
  onSelect,
  onSplit,
  onClose,
  onUpdatePane,
  onUpdateTerminalSession,
  terminalSessions,
  activeRepo,
  activeSandbox,
  sandboxCreating,
  sandboxError,
  onOpenFile,
  onRetargetFilePath,
  onClearFilePath,
  onPopOutIDE,
}: Props) {
  const [activeTab, setActiveTab] = useState<MobileTab>("agent")

  const currentPaneType = TABS.find((t) => t.id === activeTab)?.paneType ?? "agent"

  // Find the pane matching the active tab, or fall back to first pane
  const currentPane = useMemo(() => {
    return findPaneByType(root, currentPaneType) ?? findFirstPane(root)
  }, [root, currentPaneType])

  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveTab(tab)
    const pane = findPaneByType(root, TABS.find((t) => t.id === tab)?.paneType ?? "agent")
    if (pane) onSelect(pane.id)
  }, [root, onSelect])

  if (!currentPane) return null

  return (
    <div className="flex h-full flex-col">
      {/* Pane content — takes all available space */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* DndContext is required by PaneContent's useDndMonitor subscription.
            No sensors or onDragEnd needed — PaneContent already gates drag
            on !isMobile (hides the grip button, disables useDraggable). */}
        <DndContext>
        <PaneContent
          pane={currentPane}
          active
          onSelect={() => onSelect(currentPane.id)}
          onUpdatePane={onUpdatePane ? (updates) => onUpdatePane(currentPane.id, updates) : undefined}
          onUpdateTerminalSession={onUpdateTerminalSession}
          terminalSessions={terminalSessions}
          activeRepo={activeRepo}
          activeSandbox={activeSandbox}
          sandboxCreating={sandboxCreating}
          sandboxError={sandboxError}
          onOpenFile={onOpenFile}
          onRetargetFilePath={onRetargetFilePath}
          onClearFilePath={onClearFilePath}
          onSplit={(dir, type, overrides) => onSplit(currentPane.id, dir, type, overrides)}
          onClose={() => onClose(currentPane.id)}
          onPopOutIDE={onPopOutIDE ? (filePath) => onPopOutIDE(currentPane.id, filePath) : undefined}
        />
        </DndContext>
      </div>

      {/* Bottom tab bar */}
      <nav className="flex h-14 shrink-0 items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors",
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground",
            )}
          >
            <span className="text-base">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
