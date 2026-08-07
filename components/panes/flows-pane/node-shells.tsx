"use client"

import type { ReactNode, SVGProps } from "react"
import { Handle, Position } from "@xyflow/react"
import { Plus } from "iconoir-react"
import { cn } from "@/lib/utils"
import { FAILURE_HANDLE_ID, CONDITION_HANDLE_IDS } from "@/lib/flows/graph"
import type { FlowAgentHarness, FlowAgentNodeRole } from "@/lib/types"
import { FLOW_AGENT_HARNESS_OPTIONS } from "./constants"
import type { FlowNodeLibraryItem } from "./types"

export function getRoleTheme(role: FlowAgentNodeRole) {
  switch (role) {
    case "edit":
      return {
        shell: "flows-node-type-edit",
        badge: "flows-node-chip flows-node-chip-accent",
      }
    case "triage":
      return {
        shell: "flows-node-type-violet",
        badge: "flows-node-chip flows-node-chip-accent",
      }
    case "review":
    default:
      return {
        shell: "flows-node-type-review",
        badge: "flows-node-chip flows-node-chip-accent",
      }
  }
}

export function FlowHarnessIcon({
  harness,
  ...props
}: SVGProps<SVGSVGElement> & { harness: FlowAgentHarness }) {
  const option =
    FLOW_AGENT_HARNESS_OPTIONS.find((candidate) => candidate.value === harness)
    ?? FLOW_AGENT_HARNESS_OPTIONS[0]
  const Icon = option.icon
  return <Icon {...props} />
}

export function FlowNodeShell(props: {
  tone: string
  title: string
  subtitle: string
  icon?: ReactNode
  children?: ReactNode
  target?: boolean
  source?: boolean
  errorSource?: boolean
  sourceHandleId?: string | null
  sourceHandlePosition?: Position
  targetHandleId?: string | null
  targetHandlePosition?: Position
}) {
  return (
    <div className={cn("flows-node-card", props.tone)}>
      {props.target && (
        <Handle
          id={props.targetHandleId ?? undefined}
          type="target"
          position={props.targetHandlePosition ?? Position.Left}
          className="flows-node-handle flows-node-handle-target"
        />
      )}
      {props.source && (
        <Handle
          id={props.sourceHandleId ?? undefined}
          type="source"
          position={props.sourceHandlePosition ?? Position.Right}
          style={props.errorSource ? { top: "38%" } : undefined}
          className="flows-node-handle flows-node-handle-source"
        />
      )}
      {props.errorSource && (
        <Handle
          id={FAILURE_HANDLE_ID}
          type="source"
          position={Position.Right}
          style={{ top: "72%" }}
          className="flows-node-handle flows-node-handle-danger"
        />
      )}
      <div className="flows-node-inner">
        <div className="flows-node-head">
          {props.icon ? (
            <span className="flows-node-icon" aria-hidden>
              {props.icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flows-node-kicker">{props.title}</div>
            <div className="flows-node-title">{props.subtitle}</div>
          </div>
        </div>
        {props.children}
        {props.errorSource && (
          <div className="flows-node-error-label mt-3">
            On error
          </div>
        )}
      </div>
    </div>
  )
}

export function FlowNodeDetail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flows-node-meta", className)}>
      {children}
    </div>
  )
}

export function FlowNodeChip({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span className={cn("flows-node-chip", accent && "flows-node-chip-accent")}>
      {children}
    </span>
  )
}

export function FlowLibraryNodeButton({
  item,
  onAdd,
}: {
  item: FlowNodeLibraryItem
  onAdd: (
    type: FlowNodeLibraryItem["type"],
    position?: { x: number; y: number },
    operation?: import("@/lib/types").FlowActionOperation,
  ) => void
}) {
  const Icon = item.icon

  return (
    <button
      type="button"
      data-testid={`flow-library-add-${item.testId}`}
      onClick={() => onAdd(item.type, undefined, item.operation)}
      className="flows-library-item group"
    >
      <span className={cn("flows-library-icon", item.tone)} aria-hidden>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground">
          {item.label}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
          {item.description}
        </span>
      </span>
      <Plus className="ml-auto size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
    </button>
  )
}

export function ConditionNodeHandles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="flows-node-handle flows-node-handle-target"
      />
      <Handle
        id={CONDITION_HANDLE_IDS.true}
        type="source"
        position={Position.Right}
        style={{ top: "38%" }}
        className="flows-node-handle flows-node-handle-branch-primary"
      />
      <Handle
        id={CONDITION_HANDLE_IDS.false}
        type="source"
        position={Position.Right}
        style={{ top: "72%" }}
        className="flows-node-handle flows-node-handle-branch-secondary"
      />
    </>
  )
}

export function ConditionNodeShell({ children }: { children: ReactNode }) {
  return (
    <div className="flows-node-card flows-node-type-indigo min-w-[220px]">
      <ConditionNodeHandles />
      <div className="flows-node-inner">
        {children}
      </div>
    </div>
  )
}
