"use client"
import { Fragment } from "react"
import type {
  TreeNode,
  PaneNode,
  SplitNode,
  PaneType,
  MovePosition,
  TerminalSessionSummary,
} from "@/hooks/use-split-panes"
import type { SandboxError } from "@/lib/sandbox/error-state"
import type { Repo } from "@/lib/types"
import { PaneContent } from "./pane-content"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"

interface Props {
  node: TreeNode
  activeId: string
  onSelect: (id: string) => void
  onSplit: (id: string, dir: "horizontal" | "vertical", type: PaneType, overrides?: Partial<PaneNode>) => void
  onClose: (id: string) => void
  onUpdatePane?: (id: string, updates: Partial<PaneNode>) => void
  onUpdateTerminalSession?: (
    terminalSessionKey: string,
    updates: Partial<PaneNode>
  ) => void
  onUpdateSplitSizes?: (splitId: string, sizes: number[]) => void
  terminalSessions?: TerminalSessionSummary[]
  onMovePane?: (sourceId: string, targetId: string, position: MovePosition) => void
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

const isPane = (n: TreeNode): n is PaneNode => "type" in n

function getPanelMinSize(node: TreeNode, direction: "horizontal" | "vertical") {
  if (direction === "horizontal") {
    if (isPane(node)) {
      switch (node.type) {
        case "agent":
          return 24
        case "files":
          return 18
        case "preview":
          return 28
        default:
          return 20
      }
    }
    return 24
  }

  if (isPane(node)) {
    switch (node.type) {
      case "preview":
        return 24
      case "terminal":
        return 20
      default:
        return 18
    }
  }

  return 18
}

export function SplitContainer(props: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    if (!props.onMovePane) return
    const sourceId = String(event.active.id)
    const data = event.over?.data.current as
      | { paneId: string; position: MovePosition }
      | undefined
    if (!data || !sourceId) return
    if (data.paneId === sourceId) return
    props.onMovePane(sourceId, data.paneId, data.position)
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SplitTree {...props} />
    </DndContext>
  )
}

function SplitTree({ node, activeId, onSelect, onSplit, onClose, onUpdatePane, onUpdateTerminalSession, onUpdateSplitSizes, terminalSessions, onMovePane, activeRepo, activeSandbox, sandboxCreating, sandboxError, onOpenFile, onRetargetFilePath, onClearFilePath, onPopOutIDE }: Props) {
  if (isPane(node)) {
    return (
      <div className="h-full">
        <PaneContent
          pane={node}
          active={node.id === activeId}
          onSelect={() => onSelect(node.id)}
          activeRepo={activeRepo}
          activeSandbox={activeSandbox}
          sandboxCreating={sandboxCreating}
          sandboxError={sandboxError}
          onOpenFile={onOpenFile}
          onRetargetFilePath={onRetargetFilePath}
          onClearFilePath={onClearFilePath}
          onSplit={(dir, type, overrides) => onSplit(node.id, dir, type, overrides)}
          onClose={() => onClose(node.id)}
          onUpdatePane={onUpdatePane ? (updates) => onUpdatePane(node.id, updates) : undefined}
          onUpdateTerminalSession={onUpdateTerminalSession}
          terminalSessions={terminalSessions}
          onPopOutIDE={onPopOutIDE ? (filePath) => onPopOutIDE(node.id, filePath) : undefined}
        />
      </div>
    )
  }
  const split = node as SplitNode
  const direction = split.dir === "horizontal" ? "horizontal" : "vertical"
  return (
    <ResizablePanelGroup
      id={split.id}
      direction={direction}
      className="h-full"
      onLayout={(sizes) => onUpdateSplitSizes?.(split.id, sizes)}
    >
      {split.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <ResizableHandle withHandle />}
          <ResizablePanel id={child.id} order={i} defaultSize={split.sizes[i]} minSize={getPanelMinSize(child, direction)}>
            <SplitTree
              node={child}
              activeId={activeId}
              onSelect={onSelect}
              onSplit={onSplit}
              onClose={onClose}
              onUpdatePane={onUpdatePane}
              onUpdateTerminalSession={onUpdateTerminalSession}
              onUpdateSplitSizes={onUpdateSplitSizes}
              terminalSessions={terminalSessions}
              onMovePane={onMovePane}
              activeRepo={activeRepo}
              activeSandbox={activeSandbox}
              sandboxCreating={sandboxCreating}
              sandboxError={sandboxError}
              onOpenFile={onOpenFile}
              onRetargetFilePath={onRetargetFilePath}
              onClearFilePath={onClearFilePath}
              onPopOutIDE={onPopOutIDE}
            />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  )
}
