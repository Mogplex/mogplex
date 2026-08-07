"use client"

import { createPortal } from "react-dom"
import type { FlowActionOperation } from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import type { FlowContextMenuState } from "./types"
import { FLOW_NODE_INSERTION_OPTIONS, FLOW_EDGE_INSERTION_OPTIONS } from "./constants"

export interface CanvasContextMenuProps {
  contextMenu: FlowContextMenuState
  contextMenuRef: React.RefObject<HTMLDivElement | null>
  contextMenuPosition: { left: number; top: number }
  hasCanvasSelection: boolean
  canUndo: boolean
  canRedo: boolean
  saving: boolean
  dirty: boolean
  draftNodes: FlowCanvasNode[]
  runContextMenuAction: (action: () => void | Promise<unknown>) => void
  addNode: (
    type: "agent" | "action" | "condition" | "parallel" | "join" | "delay" | "await_event" | "set_variable" | "transform",
    position?: { x: number; y: number },
    operation?: FlowActionOperation,
  ) => void
  insertNodeOnEdge: (
    edgeId: string,
    type: "agent" | "action" | "delay" | "await_event" | "set_variable" | "transform",
    position?: { x: number; y: number },
    operation?: FlowActionOperation,
  ) => boolean
  tidyCanvasLayout: () => boolean
  straightenCanvasSelection: () => boolean
  undoDraft: () => void
  redoDraft: () => void
  persistFlow: () => Promise<boolean>
  duplicateSelectedCanvasItems: () => boolean
  deleteSelectedCanvasItems: () => boolean
  selectAllCanvasAgents: () => boolean
  clearCanvasSelection: () => boolean
  duplicateContextMenuNode: (nodeId: string) => void
  deleteContextMenuNode: (nodeId: string) => void
}

export function CanvasContextMenu({
  contextMenu,
  contextMenuRef,
  contextMenuPosition,
  hasCanvasSelection,
  canUndo,
  canRedo,
  saving,
  dirty,
  draftNodes,
  runContextMenuAction,
  addNode,
  insertNodeOnEdge,
  tidyCanvasLayout,
  straightenCanvasSelection,
  undoDraft,
  redoDraft,
  persistFlow,
  duplicateSelectedCanvasItems,
  deleteSelectedCanvasItems,
  selectAllCanvasAgents,
  clearCanvasSelection,
  duplicateContextMenuNode,
  deleteContextMenuNode,
}: CanvasContextMenuProps) {
  if (typeof document === "undefined") return null

  return createPortal(
    <div
      ref={contextMenuRef}
      data-testid="flow-context-menu"
      data-canvas-shortcuts="ignore"
      className="flows-theme fixed z-50 min-w-[240px] rounded-lg border border-border/80 bg-popover/96 p-1.5 shadow-2xl backdrop-blur-xl"
      style={{
        position: "fixed",
        maxHeight: "calc(100vh - 24px)",
        overflowY: "auto",
        ...contextMenuPosition,
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {contextMenu.kind === "canvas" ? (
        <div className="space-y-1">
          {FLOW_NODE_INSERTION_OPTIONS.map((option) => (
            <button
              key={`${option.type}-${option.operation ?? "default"}`}
              data-testid={`flow-context-add-${option.type}${option.operation ? `-${option.operation}` : ""}`}
              type="button"
              onClick={() => runContextMenuAction(() => addNode(
                option.type,
                contextMenu.flowPosition ?? undefined,
                option.operation,
              ))}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Add {option.label.toLowerCase()}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => runContextMenuAction(() => {
              tidyCanvasLayout()
            })}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Tidy graph
          </button>
          <button
            type="button"
            onClick={() => runContextMenuAction(() => {
              straightenCanvasSelection()
            })}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Straighten selection
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            data-testid="flow-context-undo"
            type="button"
            onClick={() => runContextMenuAction(undoDraft)}
            disabled={!canUndo}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Undo
          </button>
          <button
            data-testid="flow-context-redo"
            type="button"
            onClick={() => runContextMenuAction(redoDraft)}
            disabled={!canRedo}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Redo
          </button>
          <button
            data-testid="flow-context-save"
            type="button"
            onClick={() => runContextMenuAction(persistFlow)}
            disabled={saving || !dirty}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Save
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            data-testid="flow-context-duplicate-selection"
            type="button"
            onClick={() => runContextMenuAction(() => {
              duplicateSelectedCanvasItems()
            })}
            disabled={!draftNodes.some((node) => node.type !== "start" && node.type !== "end" && node.selected)}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Duplicate selection
          </button>
          <button
            data-testid="flow-context-delete-selection"
            type="button"
            onClick={() => runContextMenuAction(() => {
              deleteSelectedCanvasItems()
            })}
            disabled={!hasCanvasSelection}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-accent-red transition-colors hover:bg-accent hover:text-accent-red disabled:pointer-events-none disabled:opacity-50"
          >
            Delete selection
          </button>
          <button
            data-testid="flow-context-select-all"
            type="button"
            onClick={() => runContextMenuAction(() => {
              selectAllCanvasAgents()
            })}
            disabled={!draftNodes.some((node) => node.type !== "start" && node.type !== "end")}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Select all editable nodes
          </button>
          <button
            data-testid="flow-context-clear-selection"
            type="button"
            onClick={() => runContextMenuAction(() => {
              clearCanvasSelection()
            })}
            disabled={!hasCanvasSelection}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Clear selection
          </button>
        </div>
      ) : contextMenu.kind === "edge" ? (
        <div className="space-y-1">
          {FLOW_EDGE_INSERTION_OPTIONS.map((option) => (
            <button
              key={`${option.type}-${option.operation ?? "default"}`}
              data-testid={`flow-context-edge-add-${option.type}${option.operation ? `-${option.operation}` : ""}`}
              type="button"
              onClick={() => runContextMenuAction(() => {
                if (contextMenu.edgeId) {
                  insertNodeOnEdge(
                    contextMenu.edgeId,
                    option.type,
                    contextMenu.flowPosition ?? undefined,
                    option.operation,
                  )
                }
              })}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {option.label}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          <button
            data-testid="flow-context-edge-clear-selection"
            type="button"
            onClick={() => runContextMenuAction(() => {
              clearCanvasSelection()
            })}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Clear selection
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {contextMenu.nodeType && contextMenu.nodeType !== "start" && contextMenu.nodeType !== "end" && (
            <>
              <button
                data-testid="flow-context-node-duplicate"
                type="button"
                onClick={() => runContextMenuAction(() => {
                  if (contextMenu.nodeId) {
                    duplicateContextMenuNode(contextMenu.nodeId)
                  }
                })}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Duplicate
              </button>
              <button
                data-testid="flow-context-node-delete"
                type="button"
                onClick={() => runContextMenuAction(() => {
                  if (contextMenu.nodeId) {
                    deleteContextMenuNode(contextMenu.nodeId)
                  }
                })}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-accent-red transition-colors hover:bg-accent hover:text-accent-red"
              >
                Delete
              </button>
              <div className="my-1 h-px bg-border" />
            </>
          )}
          <button
            data-testid="flow-context-node-clear-selection"
            type="button"
            onClick={() => runContextMenuAction(() => {
              clearCanvasSelection()
            })}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Clear selection
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
