"use client"

import { useEffect } from "react"
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react"
import { ListSelect } from "iconoir-react"
import { cn } from "@/lib/utils"
import {
  classifyBranchRows,
  classifyKindLabel,
} from "@/lib/flows/classify-branches"
import type { FlowClassifyNodeData } from "@/lib/types"
import { FlowNodeDetail } from "./node-shells"

const ROW_HEIGHT_PX = 20
// Matches .flows-node-inner's bottom padding, so a handle lines up with its row.
const INNER_PADDING_BOTTOM_PX = 11

export function ClassifyNodeCard(props: {
  id: string
  data: FlowClassifyNodeData
}) {
  const rows = classifyBranchRows(props.data)
  const updateNodeInternals = useUpdateNodeInternals()
  const handleKey = rows.map((row) => row.handleId ?? "default").join("|")
  // Handles are added and removed as options change; React Flow caches their
  // positions per node and must be told to measure again.
  useEffect(() => {
    updateNodeInternals(props.id)
  }, [handleKey, props.id, updateNodeInternals])

  return (
    <div className="flows-node-card flows-node-type-indigo min-w-[220px]">
      <Handle
        type="target"
        position={Position.Left}
        className="flows-node-handle flows-node-handle-target"
      />
      {rows.map((row, index) => (
        <Handle
          key={row.handleId ?? "default"}
          id={row.handleId ?? undefined}
          type="source"
          position={Position.Right}
          style={{
            top: "auto",
            bottom:
              INNER_PADDING_BOTTOM_PX +
              (rows.length - 1 - index) * ROW_HEIGHT_PX,
          }}
          className={cn(
            "flows-node-handle",
            row.tone === "error"
              ? "flows-node-handle-danger"
              : row.tone === "uncertain"
                ? "flows-node-handle-branch-secondary"
                : "flows-node-handle-branch-primary"
          )}
        />
      ))}
      <div className="flows-node-inner">
        <div className="flows-node-head">
          <span className="flows-node-icon" aria-hidden>
            <ListSelect />
          </span>
          <div className="min-w-0">
            <div className="flows-node-kicker">Classify</div>
            <div className="flows-node-title">
              {props.data.label || "Classify"}
            </div>
          </div>
        </div>
        <FlowNodeDetail className="mt-2 line-clamp-2 max-w-[260px]">
          {props.data.question || "Add a question"}
        </FlowNodeDetail>
        <FlowNodeDetail className="mt-1 text-[10px] uppercase tracking-[0.16em]">
          {classifyKindLabel(props.data.output)}
        </FlowNodeDetail>
        <div className="mt-2">
          {rows.map((row) => (
            <div
              key={row.handleId ?? "default"}
              style={{ height: ROW_HEIGHT_PX }}
              className={cn(
                "flex items-center justify-end truncate text-[9px] font-medium uppercase tracking-[0.16em]",
                row.tone === "error"
                  ? "flows-node-error-label"
                  : "flows-node-meta"
              )}
            >
              {row.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
